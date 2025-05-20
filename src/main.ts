import axios from "axios";
import { randomUUID } from "crypto";
import { createReadStream, existsSync } from "fs";
import { mkdir, stat } from "fs/promises";
import { google } from "googleapis";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { extname, join } from "path";
import "../cron/checkCoverageBot";
import "../cron/checkCoverageStatus"; // Import the cron job
import {
  API_KEY,
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_USER,
  PORT,
  UPLOADS_DIR,
} from "./config";

// MySQL Database Configuration
const dbConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Create MySQL pool
const pool = mysql.createPool(dbConfig);
export { pool };

// Define types
type FormSubmission = {
  id: string;
  timestamp: string;
  salesmanName: string;
  customerName: string;
  customerAddress: string;
  customerHomeNo: string;
  village: string;
  coordinates: string;
  buildingType: string;
  operators: string[];
  buildingPhotos?: string[];
  remarks?: string;
};

/**
 * Formats a JavaScript Date object into MySQL DATETIME format
 * Converts ISO format (2025-04-06T16:52:28.435Z) to MySQL format (2025-04-06 16:52:28)
 */
function formatMySQLDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getCurrentDateTimeInGMT7(date: Date): string {
  const gmt7Time = new Date(date.getTime() + 7 * 60 * 60 * 1000); // Add 7 hours to UTC
  return gmt7Time.toISOString().slice(0, 19).replace("T", " "); // Format as 'YYYY-MM-DD HH:mm:ss'
}

// Create app instance
const app = new Hono();

// Note: Migrations are not run automatically on startup
// Run migrations manually using: bun run migrate

// Middleware
app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposeHeaders: [
      "Content-Length",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
    ],
    maxAge: 600,
    credentials: true,
  })
);

// Simple API key authentication for non-public endpoints
const apiKeyAuth = async (c: any, next: any) => {
  const apiKey = c.req.header("X-API-Key");

  if (!apiKey || apiKey !== API_KEY) {
    return c.json({ error: "Unauthorized - Invalid API Key" }, 401);
  }

  await next();
};

// Serve uploaded files
app.use("/uploads/*", async (c, next) => {
  // Only serve valid file types
  const path = c.req.path.replace("/uploads/", "");
  const ext = extname(path).toLowerCase();
  const allowedExts = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".pdf",
    ".mp4",
    ".mov",
    ".avi",
    ".webm",
  ];

  if (!allowedExts.includes(ext)) {
    return c.json({ error: "File type not allowed" }, 403);
  }

  // Validate that the file exists in uploads directory
  const filePath = join(UPLOADS_DIR, path);
  try {
    await stat(filePath);
  } catch (error) {
    return c.json({ error: "File not found" }, 404);
  }

  await next();
});

app.use("/uploads/*", serveStatic({ root: "./" }));

// Serve static files from the Next.js output
app.use("/*", serveStatic({ root: "./public" }));

// API endpoints
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Salesman names endpoint
app.get("/api/salesman", async (c) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT name FROM salesman ORDER BY name"
    );
    return c.json(rows.map((row) => row.name));
  } catch (error) {
    console.error("Error in /api/salesman:", error);
    return c.json(["Firtana", "Ahmad", "Budi"], 200); // Fallback data
  }
});

// New endpoint: Search salesmen
app.get("/api/salesman/search", async (c) => {
  try {
    const query = c.req.query("query") || "";

    // If query is empty, return a limited set (e.g., top 20 salesmen)
    if (!query.trim()) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT name FROM salesman ORDER BY name LIMIT 20"
      );
      return c.json(rows.map((row) => row.name));
    }

    // If query is provided, search with LIKE
    const searchPattern = `%${query}%`;
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT name FROM salesman WHERE name LIKE ? ORDER BY name LIMIT 50",
      [searchPattern]
    );

    return c.json(rows.map((row) => row.name));
  } catch (error) {
    console.error("Error in /api/salesman/search:", error);
    // Return empty array instead of fallback data for search
    return c.json([], 200);
  }
});

// Building types endpoint
app.get("/api/building-types", async (c) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT type FROM building_types ORDER BY type"
    );
    return c.json(rows.map((row) => row.type));
  } catch (error) {
    console.error("Error in /api/building-types:", error);
    return c.json(
      ["Residential", "Commercial", "Industrial", "Mixed-Use"],
      200
    ); // Fallback data
  }
});

app.get("/api/submissions/:id/photos/:filename", async (c) => {
  try {
    const submissionId = c.req.param("id");
    const filename = c.req.param("filename");

    // Validate that the file exists in the database for the given submission ID
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT filename FROM building_photos WHERE submission_id = ? AND filename = ?`,
      [submissionId, filename]
    );

    if (rows.length === 0) {
      return c.json({ error: "Photo not found for this submission" }, 404);
    }

    // Construct the file path
    const filePath = join(UPLOADS_DIR, filename);

    // Check if the file exists on the server
    if (!existsSync(filePath)) {
      return c.json({ error: "File not found on server" }, 404);
    }

    // Serve the file
    const fileStream = createReadStream(filePath);
    c.res.headers.set("Content-Type", "application/octet-stream");
    return new Response(fileStream as any);
  } catch (error) {
    console.error("Error fetching photo file:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// Validate and save form submission
app.post("/api/submit-form", async (c) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const formData = await c.req.formData();

    // Get current date and format it properly for MySQL
    const now = new Date();
    const formattedTimestamp = formatMySQLDateTime(now);

    // Extract form fields
    const submission: Partial<FormSubmission> = {
      id: randomUUID(),
      timestamp: formattedTimestamp, // Using properly formatted timestamp for MySQL
      salesmanName: formData.get("salesmanName") as string,
      customerName: formData.get("customerName") as string,
      customerAddress: formData.get("customerAddress") as string,
      customerHomeNo: formData.get("customerHomeNo") as string,
      village: formData.get("village") as string,
      coordinates: formData.get("coordinates") as string,
      buildingType: formData.get("buildingType") as string,
      operators: (formData.getAll("operators") as string[]) || [],
      buildingPhotos: [],
      remarks: formData.get("remarks") as string,
    };

    // Validate required fields
    const requiredFields = [
      "salesmanName",
      "customerName",
      "customerAddress",
      "customerHomeNo",
      "village",
      "coordinates",
      "buildingType",
    ];
    const missingFields = requiredFields.filter(
      (field) => !submission[field as keyof typeof submission]
    );

    if (missingFields.length > 0 || submission.operators!.length === 0) {
      if (connection) connection.release();
      return c.json(
        {
          success: false,
          message: `Missing required fields: ${missingFields.join(", ")}${
            missingFields.length > 0 && submission.operators!.length === 0
              ? " and operators"
              : submission.operators!.length === 0
              ? "operators"
              : ""
          }`,
        },
        400
      );
    }

    let hasFSOperator = submission.operators?.includes("FS");

    // Handle file uploads
    const files = formData.getAll("buildingPhotos") as File[];

    if (files && files.length > 0) {
      if (files.length > 5) {
        if (connection) connection.release();
        return c.json(
          {
            success: false,
            message: "Maximum 5 files allowed",
          },
          400
        );
      }

      // Check file sizes
      const oversizedFiles = files.filter(
        (file) => file.size > 10 * 1024 * 1024
      );
      if (oversizedFiles.length > 0) {
        if (connection) connection.release();
        return c.json(
          {
            success: false,
            message: "Files must be less than 10MB each",
          },
          400
        );
      }

      // Create uploads directory if it doesn't exist
      await mkdir(UPLOADS_DIR, { recursive: true });

      // Save files
      for (const file of files) {
        if (file.size > 0) {
          // Generate safe filename
          const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
          const filename = `${Date.now()}-${originalName}`;
          const path = join(UPLOADS_DIR, filename);

          await Bun.write(path, await file.arrayBuffer());
          submission.buildingPhotos!.push(filename);
        }
      }
    }

    // Insert submission into database
    await connection.execute(
      `INSERT INTO submissions
      (id, timestamp, salesmanName, customerName, customerAddress, customerHomeNo, village, coordinates, buildingType, operators, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        submission.id,
        submission.timestamp, // Now using the correctly formatted timestamp
        submission.salesmanName,
        submission.customerName,
        submission.customerAddress,
        submission.customerHomeNo,
        submission.village,
        submission.coordinates,
        submission.buildingType,
        JSON.stringify(submission.operators),
        submission.remarks,
      ]
    );

    // Insert building photos if any
    if (submission.buildingPhotos && submission.buildingPhotos.length > 0) {
      for (const photo of submission.buildingPhotos) {
        await connection.execute(
          `INSERT INTO building_photos (submission_id, filename) VALUES (?, ?)`,
          [submission.id, photo]
        );
      }
    }

    await connection.commit();
    connection.release();

    // send to spreadsheet
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: process.env.SERVICE_ACCOUNT_JSON_KEY_FILE,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const authClient = await auth.getClient();
      const sheets = google.sheets({ version: "v4", auth: authClient as any });

      const fsCheckCoverageSpreadsheetId =
        process.env.FS_CHECK_COVERAGE_SPREADSHEET;
      const allCheckCoverageSpreadsheetId =
        process.env.ALL_CHECK_COVERAGE_SPREADSHEET;

      const range = "Sheet1!A1"; // Just specify the sheet, not actual last row

      const values = [
        submission.id,
        getCurrentDateTimeInGMT7(now),
        submission.customerName,
        submission.customerAddress + " " + submission.village,
        submission.customerHomeNo,
        submission.coordinates,
        submission.salesmanName,
        submission.buildingType,
        submission.buildingPhotos
          ? submission.buildingPhotos
              .map(
                (photo) =>
                  `${process.env.API_URL}/${
                    process.env.APP_ENV === "development" ? "api" : "xapi"
                  }/submissions/${submission.id}/photos/${photo}`
              )
              .join(", ")
          : "",
        submission.remarks,
      ];
      if (hasFSOperator) {
        const response2 = await sheets.spreadsheets.values.append({
          spreadsheetId: fsCheckCoverageSpreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [values],
          },
        });
        if (response2.status === 200 || response2.status === 201) {
          await connection.execute(
            `UPDATE submissions SET writeToFSOperatorSpreadsheetAt = ? WHERE id = ?`,
            [formattedTimestamp, submission.id]
          );
        }
      }

      values.push(submission.operators?.join(", "));
      const response1 = await sheets.spreadsheets.values.append({
        spreadsheetId: allCheckCoverageSpreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [values],
        },
      });
      if (response1.status == 200 || response1.status == 201) {
        await connection.execute(
          `UPDATE submissions SET writeToAllOperatorSpreadsheetAt = ? WHERE id = ?`,
          [formattedTimestamp, submission.id]
        );
      }
    } catch (error) {
      console.error("error send to google sheets", error);
    }

    // send to bot check coverage fs
    if (hasFSOperator) {
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
          file: submission.buildingPhotos
            ? submission.buildingPhotos
                .map(
                  (photo) =>
                    `${process.env.API_URL}/${
                      process.env.APP_ENV === "development" ? "api" : "xapi"
                    }/submissions/${submission.id}/photos/${photo}`
                )
                .join(", ")
            : "",
        };

        // Make the POST request
        const response = await axios.post(url, payload, { headers });
        if (response.status === 200 || response.status === 201) {
          const checkCoverageBotId = response.data.data[0]?.id;
          await connection.execute(
            `UPDATE submissions SET checkCoverageBotId = ? WHERE id = ?`,
            [checkCoverageBotId, submission.id]
          );
        }
      } catch (error) {
        console.error("Error sending to bot check coverage fs:", error);
      }
    }

    // Return ISO timestamp for API consistency, even though we store it differently in MySQL
    return c.json({
      success: true,
      submissionId: submission.id,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Error processing form submission:", error);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Error rolling back transaction:", rollbackError);
      }
      connection.release();
    }
    return c.json(
      {
        success: false,
        message: "Server error processing submission",
      },
      500
    );
  }
});

// List submissions (protected admin endpoint)
app.get("/api/submissions", apiKeyAuth, async (c) => {
  try {
    const [submissionsRows] = await pool.execute<RowDataPacket[]>(`
      SELECT s.*, GROUP_CONCAT(bp.filename) as photo_filenames
      FROM submissions s
      LEFT JOIN building_photos bp ON s.id = bp.submission_id
      GROUP BY s.id
      ORDER BY s.timestamp DESC
    `);

    // Format the data to match the expected structure
    const submissions = submissionsRows.map((row) => {
      const photoFiles = row.photo_filenames
        ? row.photo_filenames.split(",")
        : [];

      // Convert MySQL datetime to ISO format for API consistency
      const timestamp = new Date(row.timestamp).toISOString();

      return {
        id: row.id,
        timestamp: timestamp,
        salesmanName: row.salesmanName,
        customerName: row.customerName,
        customerAddress: row.customerAddress,
        village: row.village, // Include village field that was missing
        coordinates: row.coordinates,
        buildingType: row.buildingType,
        operators:
          typeof row?.operators === "string"
            ? JSON.parse(row?.operators)
            : row?.operators,
        remarks: row.remarks,
        buildingPhotos: photoFiles,
      };
    });

    return c.json(submissions);
  } catch (error) {
    console.error("Error fetching submissions:", error);
    return c.json([], 200);
  }
});

// Get a single submission by ID
app.get("/api/submissions/:id", apiKeyAuth, async (c) => {
  try {
    const id = c.req.param("id");

    const [submissionRows] = await pool.execute<RowDataPacket[]>(
      `SELECT s.*, GROUP_CONCAT(bp.filename) as photo_filenames
       FROM submissions s
       LEFT JOIN building_photos bp ON s.id = bp.submission_id
       WHERE s.id = ?
       GROUP BY s.id`,
      [id]
    );

    if (submissionRows.length === 0) {
      return c.json({ error: "Submission not found" }, 404);
    }

    const row = submissionRows[0];
    const photoFiles = row?.photo_filenames
      ? row.photo_filenames.split(",")
      : [];

    // Convert MySQL datetime to ISO format for API consistency
    const timestamp = new Date(row?.timestamp).toISOString();

    const submission = {
      id: row?.id,
      timestamp: timestamp,
      salesmanName: row?.salesmanName,
      customerName: row?.customerName,
      customerAddress: row?.customerAddress,
      village: row?.village, // Include village field that was missing
      coordinates: row?.coordinates,
      buildingType: row?.buildingType,
      operators:
        typeof row?.operators === "string"
          ? JSON.parse(row?.operators)
          : row?.operators,
      buildingPhotos: photoFiles,
      remarks: row?.remarks,
    };

    return c.json(submission);
  } catch (error) {
    console.error("Error fetching submission:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// Add a new salesman
app.post("/api/salesman", apiKeyAuth, async (c) => {
  try {
    const { name } = await c.req.json();

    if (!name || typeof name !== "string" || name.trim() === "") {
      return c.json({ error: "Valid name is required" }, 400);
    }

    // Check if the salesman already exists
    const [existingRows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM salesman WHERE name = ?",
      [name.trim()]
    );

    if (existingRows.length > 0) {
      return c.json({ error: "Salesman already exists" }, 409);
    }

    // Add the new salesman
    await pool.execute("INSERT INTO salesman (name) VALUES (?)", [name.trim()]);

    // Get all salesmen to return in the response
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT name FROM salesman ORDER BY name"
    );
    const salesmanData = rows.map((row) => row.name);

    return c.json({ success: true, salesmanData });
  } catch (error) {
    console.error("Error adding salesman:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// Add a new building type
app.post("/api/building-types", apiKeyAuth, async (c) => {
  try {
    const { type } = await c.req.json();

    if (!type || typeof type !== "string" || type.trim() === "") {
      return c.json({ error: "Valid building type is required" }, 400);
    }

    // Check if the building type already exists
    const [existingRows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM building_types WHERE type = ?",
      [type.trim()]
    );

    if (existingRows.length > 0) {
      return c.json({ error: "Building type already exists" }, 409);
    }

    // Add the new building type
    await pool.execute("INSERT INTO building_types (type) VALUES (?)", [
      type.trim(),
    ]);

    // Get all building types to return in the response
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT type FROM building_types ORDER BY type"
    );
    const buildingTypes = rows.map((row) => row.type);

    return c.json({ success: true, buildingTypes });
  } catch (error) {
    console.error("Error adding building type:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// Search villages endpoint now using postal_codes table
app.get("/api/villages/search", async (c) => {
  try {
    const query = c.req.query("query") || "";

    // If query is empty, return a limited set from postal_codes
    if (!query.trim()) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT CONCAT(postal_code, ', ', village, ', ', district, ', ', city, ', ', province) AS name FROM postal_codes LIMIT 5"
      );
      return c.json(rows.map((row) => row.name));
    }

    // If query is provided, search with LIKE
    const searchPattern = `%${query}%`;
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT CONCAT(postal_code, ', ', village, ', ', district, ', ', city, ', ', province) AS name FROM postal_codes WHERE postal_code LIKE ? OR village LIKE ? OR district LIKE ? OR city LIKE ? LIMIT 20",
      [searchPattern, searchPattern, searchPattern, searchPattern]
    );

    return c.json(rows.map((row) => row.name));
  } catch (error) {
    console.error("Error in /api/villages/search:", error);
    // Return empty array instead of fallback data for search
    return c.json([], 200);
  }
});

// Catch-all route to serve the Next.js frontend
app.get("*", (c) => {
  return c.redirect("/");
});

// Error handling
app.onError((err, c) => {
  console.error("Application error:", err);

  if (err instanceof HTTPException) {
    return c.json(
      {
        error: err.message,
        status: err.status,
      },
      err.status
    );
  }

  return c.json(
    {
      error: "Internal Server Error",
      status: 500,
    },
    500
  );
});

export default {
  port: Number(PORT),
  fetch: app.fetch,
};
