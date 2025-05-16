import cron from 'node-cron';
import axios from 'axios';
import { pool } from '../src/main'; // Import the MySQL pool from your main file
import { google } from 'googleapis';

async function runCronJob() {
	console.log('Running cron job to retrieve update status from bot check coverage service');

	try {
		// Fetch submissions that need status updates
		const [rows] = await pool.execute(
			`SELECT id, checkCoverageBotId FROM submissions WHERE checkCoverageBotId IS NOT NULL AND checkCoverageBotFinish = 0`
		);

		const submissions = rows as { id: string; checkCoverageBotId: number }[];

		if (submissions.length === 0) {
			console.log('No submissions require status updates');
			return;
		}

		let sheetIds: string[][] = []; // Initialize sheetIds as an empty array
		let sheets: any;
		try {
			const auth = new google.auth.GoogleAuth({
				keyFile: process.env.SERVICE_ACCOUNT_JSON_KEY_FILE,
				scopes: ['https://www.googleapis.com/auth/spreadsheets'],
			});
			const authClient = await auth.getClient();
			sheets = google.sheets({ version: 'v4', auth: authClient });

			const range = 'Sheet1!A:A'; // only fetch column A
			const response = await sheets.spreadsheets.values.get({
				spreadsheetId: process.env.FS_CHECK_COVERAGE_SPREADSHEET,
				range,
			});
			sheetIds = response.data.values || []; // Ensure sheetIds is an array
		} catch (error) {
			console.log('Error fetching spreadsheet data:', error.message);
			return;
		}

		for (const submission of submissions) {
			try {
				// Make a request to the bot check coverage service to get the status
				const url = `${process.env.FS_CHECK_COVERAGE_BOT_HOST}/api/check-coverage/${submission.checkCoverageBotId}`;
				const headers = {
					'Content-Type': 'application/json',
					'x-api-key': process.env.FS_CHECK_COVERAGE_BOT_API_KEY,
				};

				const response = await axios.get(url, { headers });

				if (response.status === 200) {
					const content = response.data?.data;
					const isCovered = content.is_covered;
					const homepassedId = content.homepassed_id;

					if (isCovered !== null) {
						if ((isCovered == 1 && homepassedId) || isCovered == 0) {
							await pool.execute(
								`UPDATE submissions SET checkCoverageBotFinish = ? WHERE id = ?`,
								[1, submission.id]
							);
						}

						const rowIndex = sheetIds.findIndex((row) => row[0] === submission.id);
						const updateRange = "Sheet1!K" + (rowIndex + 1); // Assuming you want to update column J

						const updateValues = [
							isCovered ? 'Covered' : 'Not Covered',
							homepassedId ? homepassedId : '',
							content.operator_remarks ? content.operator_remarks : ''
						];

						// Write to the spreadsheet
						await sheets.spreadsheets.values.update({
							spreadsheetId: process.env.FS_CHECK_COVERAGE_SPREADSHEET,
							range: updateRange,
							valueInputOption: 'USER_ENTERED',
							requestBody: {
							values: [updateValues],
							},
						});
					}
				} else {
					console.error(`Failed to fetch status for submission ID ${submission.id}. HTTP Status: ${response.status}`);
				}
			} catch (error) {
				console.error(`Error fetching status for submission ID ${submission.id}:`, error.message);
			}
		}
	} catch (error) {
		console.error('Error in cron job:', error.message);
	}
}

cron.schedule('*/5 * * * *', runCronJob); // Run every 5 minutes
// runCronJob(); // Uncomment this line to run the cron job immediately