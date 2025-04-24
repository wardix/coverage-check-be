import axios from 'axios';
import { JSDOM } from 'jsdom';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Interface for postal code data
 */
interface PostalCodeData {
  postalCode: string;
  village: string;
  district: string;
  city: string;
  province: string;
}

/**
 * Fetches postal code data from the Indonesian postal service website
 * 
 * @param query - The search query (location name or postal code)
 * @returns Promise with array of postal code data
 */
async function getIndonesianPostalCodes(query: string): Promise<PostalCodeData[]> {
  try {
    // API endpoint and request config
    const url = 'https://kodepos.posindonesia.co.id/CariKodepos';
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };
    const data = `kodepos=${encodeURIComponent(query)}`;

    // Make the POST request
    const response = await axios.post(url, data, { headers });
    
    // Parse the HTML response using jsdom
    const dom = new JSDOM(response.data);
    const document = dom.window.document;
    
    // Get table rows excluding the header row
    const tableRows = document.querySelectorAll('#list-data tbody tr');
    
    // Parse each row to extract the postal code data
    const postalCodes: PostalCodeData[] = Array.from(tableRows).map(row => {
      const cells = row.querySelectorAll('td');
      
      return {
        postalCode: cells[1].textContent?.trim() || '',
        village: cells[2].textContent?.trim() || '',
        district: cells[3].textContent?.trim() || '',
        city: cells[4].textContent?.trim() || '',
        province: cells[5].textContent?.trim() || ''
      };
    });
    
    return postalCodes;
  } catch (error) {
    console.error('Error fetching postal codes:', error);
    throw error;
  }
}

/**
 * Example usage with formatting for display
 */
async function searchPostalCodes(query: string): Promise<void> {
  try {
    console.log(`Searching for postal codes matching: "${query}"`);
    const postalCodes = await getIndonesianPostalCodes(query);
    
    if (postalCodes.length === 0) {
      console.log('No results found.');
      return;
    }
    
    console.log(`Found ${postalCodes.length} results:`);
    console.table(postalCodes);
    
    // Alternative display format
    /*
    postalCodes.forEach(item => {
      console.log(`
        Postal Code: ${item.postalCode}
        Village: ${item.village}
        District: ${item.district}
        City: ${item.city}
        Province: ${item.province}
      `);
    });
    */
  } catch (error) {
    console.error('Search failed:', error);
  }
}

// Example usage
// searchPostalCodes('kota binjai');

/**
 * MySQL Database configuration
 */
interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/**
 * Connects to a MySQL database
 * 
 * @param config - MySQL connection configuration
 * @returns Connected MySQL connection
 */
async function connectToMySQL(config: DatabaseConfig): Promise<mysql.Connection> {
  try {
    // Create connection to MySQL
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database
    });
    
    console.log('Connected to MySQL successfully');
    return connection;
  } catch (error) {
    console.error('Failed to connect to MySQL:', error);
    throw error;
  }
}

/**
 * Creates the postal_codes table if it doesn't exist
 * 
 * @param connection - MySQL connection
 */
async function createPostalCodesTable(connection: mysql.Connection): Promise<void> {
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS postal_codes (
        postal_code VARCHAR(10) NOT NULL,
        village VARCHAR(100) NOT NULL,
        district VARCHAR(100) NOT NULL,
        city VARCHAR(100) NOT NULL,
        province VARCHAR(100) NOT NULL,
        search_timestamp DATETIME NOT NULL,
        PRIMARY KEY (postal_code, village),
        INDEX idx_postal_code (postal_code),
        INDEX idx_village (village),
        INDEX idx_district (district),
        INDEX idx_city (city)
      )
    `);
    console.log('Postal codes table created or already exists');
  } catch (error) {
    console.error('Failed to create table:', error);
    throw error;
  }
}

/**
 * Stores postal code data in MySQL
 * 
 * @param connection - Connected MySQL connection
 * @param postalCodes - Array of postal code data to store
 * @returns Promise with the number of records inserted
 */
async function storePostalCodesInMySQL(
  connection: mysql.Connection, 
  postalCodes: PostalCodeData[]
): Promise<number> {
  try {
    // Ensure the table exists
    await createPostalCodesTable(connection);
    
    // Prepare batch insert
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    // Create values for batch insert
    const values = postalCodes.map(item => [
      item.postalCode,
      item.village,
      item.district,
      item.city,
      item.province,
      timestamp
    ]);
    
    // Execute the insert query
    const [result] = await connection.query(`
      INSERT INTO postal_codes 
      (postal_code, village, district, city, province, search_timestamp)
      VALUES ?
      ON DUPLICATE KEY UPDATE
        district = VALUES(district),
        city = VALUES(city),
        province = VALUES(province),
        search_timestamp = VALUES(search_timestamp)
    `, [values]);
    
    console.log(`Stored ${postalCodes.length} postal code records in MySQL`);
    return postalCodes.length;
  } catch (error) {
    console.error('Failed to store data in MySQL:', error);
    throw error;
  }
}

/**
 * Search for postal codes and store results in MySQL
 * 
 * @param query - The search query (location name or postal code)
 * @param dbConfig - MySQL connection configuration
 * @returns Promise with the number of records stored
 */
async function searchAndStorePostalCodes(
  query: string, 
  dbConfig: DatabaseConfig
): Promise<number> {
  let connection: mysql.Connection | null = null;
  
  try {
    // Fetch postal code data
    console.log(`Searching for postal codes matching: "${query}"`);
    const postalCodes = await getIndonesianPostalCodes(query);
    
    if (postalCodes.length === 0) {
      console.log('No results found.');
      return 0;
    }
    
    console.log(`Found ${postalCodes.length} results.`);
    
    // Connect to MySQL
    connection = await connectToMySQL(dbConfig);
    
    // Store data in MySQL
    const storedCount = await storePostalCodesInMySQL(connection, postalCodes);
    
    return storedCount;
  } catch (error) {
    console.error('Search and store operation failed:', error);
    throw error;
  } finally {
    // Ensure the connection is always closed properly
    if (connection) {
      await connection.end();
      console.log('MySQL connection closed');
    }
  }
}

/**
 * Query stored postal codes from MySQL database
 * 
 * @param connection - MySQL connection
 * @param filters - Optional filters for the query
 * @returns Promise with the query results
 */
function getDatabaseConfigFromEnv(): DatabaseConfig {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'postal_codes',
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || ''
  };
}
async function queryPostalCodes(
  connection: mysql.Connection,
  filters?: {
    postalCode?: string;
    city?: string;
    province?: string;
  }
): Promise<PostalCodeData[]> {
  try {
    let query = `
      SELECT postal_code as postalCode, village, district, city, province
      FROM postal_codes
      WHERE 1=1
    `;
    const params: any[] = [];
    
    // Add filters if provided
    if (filters?.postalCode) {
      query += ` AND postal_code = ?`;
      params.push(filters.postalCode);
    }
    
    if (filters?.city) {
      query += ` AND city LIKE ?`;
      params.push(`%${filters.city}%`);
    }
    
    if (filters?.province) {
      query += ` AND province LIKE ?`;
      params.push(`%${filters.province}%`);
    }
    
    // Execute the query
    const [rows] = await connection.execute(query, params);
    return rows as PostalCodeData[];
  } catch (error) {
    console.error('Failed to query postal codes:', error);
    throw error;
  }
}

// Example usage
// Using environment variables for DB configuration
const dbConfig = getDatabaseConfigFromEnv();

searchAndStorePostalCodes('jakarta', dbConfig)
  .then(count => console.log(`Stored ${count} records`))
  .catch(err => console.error('Error:', err));

export { 
  getIndonesianPostalCodes, 
  searchPostalCodes, 
  searchAndStorePostalCodes,
  storePostalCodesInMySQL,
  connectToMySQL,
  queryPostalCodes,
  createPostalCodesTable,
  getDatabaseConfigFromEnv,
  PostalCodeData,
  DatabaseConfig
};