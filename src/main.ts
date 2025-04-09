import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { mkdir, stat } from 'fs/promises'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import {
  API_KEY,
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_USER,
  PORT,
  UPLOADS_DIR,
} from './config'

// MySQL Database Configuration
const dbConfig = {
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}

// Create MySQL pool
const pool = mysql.createPool(dbConfig)

// Define types
type FormSubmission = {
  id: string
  timestamp: string
  salesmanName: string
  customerName: string
  customerAddress: string
  village: string
  coordinates: string
  buildingType: string
  operators: string[]
  buildingPhotos?: string[]
}

/**
 * Formats a JavaScript Date object into MySQL DATETIME format
 * Converts ISO format (2025-04-06T16:52:28.435Z) to MySQL format (2025-04-06 16:52:28)
 */
function formatMySQLDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// Create app instance
const app = new Hono()

// Initialize database tables
const initDatabase = async () => {
  try {
    const connection = await pool.getConnection()

    // Create salesman table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS salesman (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE
      )
    `)

    // Create building_types table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS building_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(255) NOT NULL UNIQUE
      )
    `)

    // Create villages table (will be populated externally)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS villages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE
      )
    `)
    // Create submissions table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS submissions (
        id VARCHAR(36) PRIMARY KEY,
        timestamp DATETIME NOT NULL,
        salesmanName VARCHAR(255) NOT NULL,
        customerName VARCHAR(255) NOT NULL,
        customerAddress TEXT NOT NULL,
        village TEXT NOT NULL,
        coordinates VARCHAR(255) NOT NULL,
        buildingType VARCHAR(255) NOT NULL,
        operators JSON NOT NULL
      )
    `)

    // Create building_photos table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS building_photos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        submission_id VARCHAR(36) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        FOREIGN KEY (submission_id) REFERENCES submissions(id)
      )
    `)

    // Insert default data if tables are empty
    const [salesmanRows] = await connection.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM salesman',
    )
    if (salesmanRows[0]?.count === 0) {
      await connection.execute(`
        INSERT INTO salesman (name) VALUES
        ('Firtana'), ('Ahmad'), ('Budi'), ('Cindy'), ('Deni')
      `)
    }

    const [buildingTypeRows] = await connection.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as count FROM building_types',
    )
    if (buildingTypeRows[0]?.count === 0) {
      await connection.execute(`
        INSERT INTO building_types (type) VALUES
        ('Residential'), ('Commercial'), ('Industrial'), ('Mixed-Use'), ('Office'), ('Retail')
      `)
    }

    connection.release()
    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Error initializing database:', error)
  }
}

// Initialize database on startup
initDatabase()

// Middleware
app.use('*', logger())
app.use(
  '/api/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposeHeaders: [
      'Content-Length',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
    ],
    maxAge: 600,
    credentials: true,
  }),
)

// Simple API key authentication for non-public endpoints
const apiKeyAuth = async (c: any, next: any) => {
  const apiKey = c.req.header('X-API-Key')

  if (!apiKey || apiKey !== API_KEY) {
    return c.json({ error: 'Unauthorized - Invalid API Key' }, 401)
  }

  await next()
}

// Serve uploaded files
app.use('/uploads/*', async (c, next) => {
  // Only serve valid file types
  const path = c.req.path.replace('/uploads/', '')
  const ext = extname(path).toLowerCase()
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']

  if (!allowedExts.includes(ext)) {
    return c.json({ error: 'File type not allowed' }, 403)
  }

  // Validate that the file exists in uploads directory
  const filePath = join(UPLOADS_DIR, path)
  try {
    await stat(filePath)
  } catch (error) {
    return c.json({ error: 'File not found' }, 404)
  }

  await next()
})

app.use('/uploads/*', serveStatic({ root: './' }))

// Serve static files from the Next.js output
app.use('/*', serveStatic({ root: './public' }))

// API endpoints
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  })
})

// Salesman names endpoint
app.get('/api/salesman', async (c) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT name FROM salesman ORDER BY name',
    )
    return c.json(rows.map((row) => row.name))
  } catch (error) {
    console.error('Error in /api/salesman:', error)
    return c.json(['Firtana', 'Ahmad', 'Budi'], 200) // Fallback data
  }
})

// New endpoint: Search salesmen
app.get('/api/salesman/search', async (c) => {
  try {
    const query = c.req.query('query') || ''

    // If query is empty, return a limited set (e.g., top 20 salesmen)
    if (!query.trim()) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT name FROM salesman ORDER BY name LIMIT 20',
      )
      return c.json(rows.map((row) => row.name))
    }

    // If query is provided, search with LIKE
    const searchPattern = `%${query}%`
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT name FROM salesman WHERE name LIKE ? ORDER BY name LIMIT 50',
      [searchPattern],
    )

    return c.json(rows.map((row) => row.name))
  } catch (error) {
    console.error('Error in /api/salesman/search:', error)
    // Return empty array instead of fallback data for search
    return c.json([], 200)
  }
})

// Building types endpoint
app.get('/api/building-types', async (c) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT type FROM building_types ORDER BY type',
    )
    return c.json(rows.map((row) => row.type))
  } catch (error) {
    console.error('Error in /api/building-types:', error)
    return c.json(['Residential', 'Commercial', 'Industrial', 'Mixed-Use'], 200) // Fallback data
  }
})

// Validate and save form submission
app.post('/api/submit-form', async (c) => {
  let connection
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()

    const formData = await c.req.formData()

    // Get current date and format it properly for MySQL
    const now = new Date()
    const formattedTimestamp = formatMySQLDateTime(now)

    // Extract form fields
    const submission: Partial<FormSubmission> = {
      id: randomUUID(),
      timestamp: formattedTimestamp, // Using properly formatted timestamp for MySQL
      salesmanName: formData.get('salesmanName') as string,
      customerName: formData.get('customerName') as string,
      customerAddress: formData.get('customerAddress') as string,
      village: formData.get('village') as string,
      coordinates: formData.get('coordinates') as string,
      buildingType: formData.get('buildingType') as string,
      operators: (formData.getAll('operators') as string[]) || [],
      buildingPhotos: [],
    }

    // Validate required fields
    const requiredFields = [
      'salesmanName',
      'customerName',
      'customerAddress',
      'vilage',
      'coordinates',
      'buildingType',
    ]
    const missingFields = requiredFields.filter(
      (field) => !submission[field as keyof typeof submission],
    )

    if (missingFields.length > 0 || submission.operators!.length === 0) {
      if (connection) connection.release()
      return c.json(
        {
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}${missingFields.length > 0 && submission.operators!.length === 0 ? ' and operators' : submission.operators!.length === 0 ? 'operators' : ''}`,
        },
        400,
      )
    }

    // Handle file uploads
    const files = formData.getAll('buildingPhotos') as File[]

    if (files && files.length > 0) {
      if (files.length > 5) {
        if (connection) connection.release()
        return c.json(
          {
            success: false,
            message: 'Maximum 5 files allowed',
          },
          400,
        )
      }

      // Check file sizes
      const oversizedFiles = files.filter(
        (file) => file.size > 10 * 1024 * 1024,
      )
      if (oversizedFiles.length > 0) {
        if (connection) connection.release()
        return c.json(
          {
            success: false,
            message: 'Files must be less than 10MB each',
          },
          400,
        )
      }

      // Create uploads directory if it doesn't exist
      await mkdir(UPLOADS_DIR, { recursive: true })

      // Save files
      for (const file of files) {
        if (file.size > 0) {
          // Generate safe filename
          const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
          const filename = `${Date.now()}-${originalName}`
          const path = join(UPLOADS_DIR, filename)

          await Bun.write(path, await file.arrayBuffer())
          submission.buildingPhotos!.push(filename)
        }
      }
    }

    // Insert submission into database
    await connection.execute(
      `INSERT INTO submissions
      (id, timestamp, salesmanName, customerName, customerAddress, village, coordinates, buildingType, operators)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        submission.id,
        submission.timestamp, // Now using the correctly formatted timestamp
        submission.salesmanName,
        submission.customerName,
        submission.customerAddress,
        submission.village,
        submission.coordinates,
        submission.buildingType,
        JSON.stringify(submission.operators),
      ],
    )

    // Insert building photos if any
    if (submission.buildingPhotos && submission.buildingPhotos.length > 0) {
      for (const photo of submission.buildingPhotos) {
        await connection.execute(
          `INSERT INTO building_photos (submission_id, filename) VALUES (?, ?)`,
          [submission.id, photo],
        )
      }
    }

    await connection.commit()
    connection.release()

    // Return ISO timestamp for API consistency, even though we store it differently in MySQL
    return c.json({
      success: true,
      submissionId: submission.id,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('Error processing form submission:', error)
    if (connection) {
      try {
        await connection.rollback()
      } catch (rollbackError) {
        console.error('Error rolling back transaction:', rollbackError)
      }
      connection.release()
    }
    return c.json(
      {
        success: false,
        message: 'Server error processing submission',
      },
      500,
    )
  }
})

// List submissions (protected admin endpoint)
app.get('/api/submissions', apiKeyAuth, async (c) => {
  try {
    const [submissionsRows] = await pool.execute<RowDataPacket[]>(`
      SELECT s.*, GROUP_CONCAT(bp.filename) as photo_filenames
      FROM submissions s
      LEFT JOIN building_photos bp ON s.id = bp.submission_id
      GROUP BY s.id
      ORDER BY s.timestamp DESC
    `)

    // Format the data to match the expected structure
    const submissions = submissionsRows.map((row) => {
      const photoFiles = row.photo_filenames
        ? row.photo_filenames.split(',')
        : []

      // Convert MySQL datetime to ISO format for API consistency
      const timestamp = new Date(row.timestamp).toISOString()

      return {
        id: row.id,
        timestamp: timestamp,
        salesmanName: row.salesmanName,
        customerName: row.customerName,
        customerAddress: row.customerAddress,
        coordinates: row.coordinates,
        buildingType: row.buildingType,
        operators: JSON.parse(row.operators),
        buildingPhotos: photoFiles,
      }
    })

    return c.json(submissions)
  } catch (error) {
    console.error('Error fetching submissions:', error)
    return c.json([], 200)
  }
})

// Get a single submission by ID
app.get('/api/submissions/:id', apiKeyAuth, async (c) => {
  try {
    const id = c.req.param('id')

    const [submissionRows] = await pool.execute<RowDataPacket[]>(
      `SELECT s.*, GROUP_CONCAT(bp.filename) as photo_filenames
       FROM submissions s
       LEFT JOIN building_photos bp ON s.id = bp.submission_id
       WHERE s.id = ?
       GROUP BY s.id`,
      [id],
    )

    if (submissionRows.length === 0) {
      return c.json({ error: 'Submission not found' }, 404)
    }

    const row = submissionRows[0]
    const photoFiles = row?.photo_filenames
      ? row.photo_filenames.split(',')
      : []

    // Convert MySQL datetime to ISO format for API consistency
    const timestamp = new Date(row.timestamp).toISOString()

    const submission = {
      id: row?.id,
      timestamp: timestamp,
      salesmanName: row?.salesmanName,
      customerName: row?.customerName,
      customerAddress: row?.customerAddress,
      coordinates: row?.coordinates,
      buildingType: row?.buildingType,
      operators: JSON.parse(row?.operators),
      buildingPhotos: photoFiles,
    }

    return c.json(submission)
  } catch (error) {
    console.error('Error fetching submission:', error)
    return c.json({ error: 'Server error' }, 500)
  }
})

// Add a new salesman
app.post('/api/salesman', apiKeyAuth, async (c) => {
  try {
    const { name } = await c.req.json()

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return c.json({ error: 'Valid name is required' }, 400)
    }

    // Check if the salesman already exists
    const [existingRows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM salesman WHERE name = ?',
      [name.trim()],
    )

    if (existingRows.length > 0) {
      return c.json({ error: 'Salesman already exists' }, 409)
    }

    // Add the new salesman
    await pool.execute('INSERT INTO salesman (name) VALUES (?)', [name.trim()])

    // Get all salesmen to return in the response
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT name FROM salesman ORDER BY name',
    )
    const salesmanData = rows.map((row) => row.name)

    return c.json({ success: true, salesmanData })
  } catch (error) {
    console.error('Error adding salesman:', error)
    return c.json({ error: 'Server error' }, 500)
  }
})

// Add a new building type
app.post('/api/building-types', apiKeyAuth, async (c) => {
  try {
    const { type } = await c.req.json()

    if (!type || typeof type !== 'string' || type.trim() === '') {
      return c.json({ error: 'Valid building type is required' }, 400)
    }

    // Check if the building type already exists
    const [existingRows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM building_types WHERE type = ?',
      [type.trim()],
    )

    if (existingRows.length > 0) {
      return c.json({ error: 'Building type already exists' }, 409)
    }

    // Add the new building type
    await pool.execute('INSERT INTO building_types (type) VALUES (?)', [
      type.trim(),
    ])

    // Get all building types to return in the response
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT type FROM building_types ORDER BY type',
    )
    const buildingTypes = rows.map((row) => row.type)

    return c.json({ success: true, buildingTypes })
  } catch (error) {
    console.error('Error adding building type:', error)
    return c.json({ error: 'Server error' }, 500)
  }
})

// Only keep the search villages endpoint - we don't need the get all villages endpoint
// Search villages endpoint
app.get('/api/villages/search', async (c) => {
  try {
    const query = c.req.query('query') || ''

    // If query is empty, return a limited set (e.g., top 20 villages)
    if (!query.trim()) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT name FROM villages ORDER BY name LIMIT 20',
      )
      return c.json(rows.map((row) => row.name))
    }

    // If query is provided, search with LIKE
    const searchPattern = `%${query}%`
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT name FROM villages WHERE name LIKE ? ORDER BY name LIMIT 50',
      [searchPattern],
    )

    return c.json(rows.map((row) => row.name))
  } catch (error) {
    console.error('Error in /api/villages/search:', error)
    // Return empty array instead of fallback data for search
    return c.json([], 200)
  }
})

// Catch-all route to serve the Next.js frontend
app.get('*', (c) => {
  return c.redirect('/')
})

// Error handling
app.onError((err, c) => {
  console.error('Application error:', err)

  if (err instanceof HTTPException) {
    return c.json(
      {
        error: err.message,
        status: err.status,
      },
      err.status,
    )
  }

  return c.json(
    {
      error: 'Internal Server Error',
      status: 500,
    },
    500,
  )
})

export default {
  port: Number(PORT),
  fetch: app.fetch,
}
