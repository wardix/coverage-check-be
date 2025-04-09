import { migrate } from '../src/migrations'

// Just run the migrate function
migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
