import mysql from 'mysql2/promise'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { DB_HOST, DB_NAME, DB_PASSWORD, DB_USER } from './config'

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

/**
 * Initialize migrations table if it doesn't exist
 */
async function initMigrationsTable() {
  const connection = await pool.getConnection()
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL
      )
    `)
  } finally {
    connection.release()
  }
}

/**
 * Run a specific migration
 */
async function runMigration(name: string, direction: 'up' | 'down') {
  const connection = await pool.getConnection()
  try {
    // Begin transaction
    await connection.beginTransaction()

    // Check if this migration has been applied (only for up migrations)
    if (direction === 'up') {
      const [rows] = await connection.execute(
        'SELECT * FROM migrations WHERE name = ?',
        [name],
      )

      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`Migration ${name} already applied, skipping`)
        await connection.commit()
        return
      }
    }

    // Read the migration file
    const filename = `${name}${direction === 'down' ? '_down' : ''}.sql`
    const filePath = join(process.cwd(), 'migrations', filename)

    const sql = await readFile(filePath, 'utf8')

    // Split by semicolons to execute multiple statements
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    // Execute each statement
    for (const statement of statements) {
      await connection.execute(statement)
    }

    // Record the migration (for up migrations)
    if (direction === 'up') {
      await connection.execute(
        'INSERT INTO migrations (name, applied_at) VALUES (?, NOW())',
        [name],
      )
    } else if (direction === 'down') {
      // Remove the migration record
      await connection.execute('DELETE FROM migrations WHERE name = ?', [name])
    }

    // Commit the transaction
    await connection.commit()
    console.log(
      `Migration ${name} ${direction === 'up' ? 'applied' : 'reverted'} successfully`,
    )
  } catch (error) {
    await connection.rollback()
    console.error(`Error applying migration ${name}:`, error)
    throw error
  } finally {
    connection.release()
  }
}

/**
 * Run all pending migrations
 */
export async function migrate() {
  try {
    await initMigrationsTable()

    // Define migrations in order
    const migrations = [
      '001_initial_schema',
      '002_add_branchid_to_salesman',
      '003_add_branchid_to_submissions',
      // Add more migrations here as they are created
    ]

    for (const migration of migrations) {
      await runMigration(migration, 'up')
    }

    console.log('All migrations applied successfully')
  } catch (error) {
    console.error('Migration error:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

/**
 * Run migrations from command line
 */
if (require.main === module) {
  migrate().catch(console.error)
}
