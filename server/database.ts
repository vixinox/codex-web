import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import type { ServerConfig } from './config.js'

export function createDatabase(config: ServerConfig) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
  })
  const db = drizzle({ client: pool })

  return { db, pool }
}

export type Database = ReturnType<typeof createDatabase>['db']
