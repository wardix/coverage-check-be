import axios from "axios";
import { type RowDataPacket } from "mysql2/promise";
import cron from "node-cron";
import { pool } from "../src/main";

async function runCronJob() {
  console.log("Running check coverage bot task every 15 minutes");

  try {
    // Get submissions that haven't been processed by the bot yet
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, customerName, customerAddress, customerHomeNo, village, coordinates, buildingType, remarks
         FROM submissions 
         WHERE JSON_CONTAINS(operators, '"FS"') 
         AND (checkCoverageBotId IS NULL OR checkCoverageBotId = '')
         LIMIT 10`
    );

    if (rows.length === 0) {
      console.log("No pending submissions to process");
      return;
    }

    console.log(`Found ${rows.length} submissions to process`);

    // Process each submission
    for (const submission of rows) {
      try {
        const url =
          process.env.FS_CHECK_COVERAGE_BOT_HOST + "/api/check-coverage";
        const headers = {
          "Content-Type": "application/json",
          "x-api-key": process.env.FS_CHECK_COVERAGE_BOT_API_KEY,
        };

        const vill = submission.village?.split(",");
        const residenceType =
          submission.buildingType === "ruko" ? "ruko" : "perumahan";
        const residenceName = residenceType == "ruko" ? "ruko" : "rumah";

        // Get building photos for this submission
        const [photoRows] = await pool.execute<RowDataPacket[]>(
          `SELECT filename FROM building_photos WHERE submission_id = ?`,
          [submission.id]
        );

        const photoUrls = photoRows
          .map(
            (photo) =>
              `${process.env.API_URL}/${
                process.env.APP_ENV === "development" ? "api" : "xapi"
              }/submissions/${submission.id}/photos/${photo.filename}`
          )
          .join(", ");

        const payload = {
          operator: "fiberstar",
          customer_name: submission.customerName,
          street_name: submission.customerAddress,
          home_no: submission.customerHomeNo,
          latitude: submission.coordinates?.split(",")[0],
          longitude: submission.coordinates?.split(",")[1],
          province: vill?.[4],
          city: vill?.[3],
          subdistrict: vill?.[2],
          village: vill?.[1],
          postal_code: vill?.[0],
          residence_type: residenceType,
          residence_name: residenceName,
          remarks: submission.remarks,
          file: photoUrls,
        };

        // Make the POST request
        const response = await axios.post(url, payload, { headers });

        if (response.status === 200 || response.status === 201) {
          const checkCoverageBotId = response.data.data[0]?.id;

          // Update the submission with the bot ID
          await pool.execute(
            `UPDATE submissions SET checkCoverageBotId = ? WHERE id = ?`,
            [checkCoverageBotId, submission.id]
          );

          console.log(`Successfully processed submission ${submission.id}`);
        } else {
          console.error(
            `Error response from bot for submission ${submission.id}:`,
            response.status
          );
        }
      } catch (error) {
        console.error(`Error processing submission ${submission.id}:`, error);
      }
    }
  } catch (error) {
    console.error("Error in check coverage bot cron job:", error);
  }
}

// Schedule task to run every 15 minutes
cron.schedule("*/15 * * * *", runCronJob);
