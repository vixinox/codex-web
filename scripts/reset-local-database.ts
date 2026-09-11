import 'dotenv/config'
import process from 'node:process'

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const parsedUrl = new URL(databaseUrl)
const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
if (!localHosts.has(parsedUrl.hostname)) {
  throw new Error('db:reset:local only allows localhost database connections')
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true',
})

async function main() {
  console.warn(
    `Resetting local database ${parsedUrl.hostname}:${parsedUrl.port || '5432'}/${parsedUrl.pathname.slice(1)}.`,
  )
  await pool.query('DROP SCHEMA public CASCADE')
  await pool.query('CREATE SCHEMA public')
  console.log('Local database cleared; schema push will run next.')
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unable to reset local database'
    console.error(`Failed to reset local database: ${message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
