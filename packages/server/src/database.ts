import DatabaseDriver from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type { ServerConfig } from './config.js'

export function createDatabase(config: ServerConfig) {
  mkdirSync(config.dataRoot, { recursive: true })
  const databasePath = path.join(config.dataRoot, 'owner.sqlite')
  if (!existsSync(databasePath)) {
    throw new Error('Owner database is not initialized. Run `pnpm db:push` first.')
  }
  const driver = new DatabaseDriver(databasePath)
  driver.pragma('foreign_keys = ON')
  driver.pragma('busy_timeout = 5000')
  try {
    assertCurrentSchema(driver)
  } catch (error) {
    driver.close()
    throw error
  }
  const db = drizzle({ client: driver })

  return { db, driver }
}

function assertCurrentSchema(driver: DatabaseDriver.Database) {
  const tables = new Set(
    (
      driver.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map(({ name }) => name),
  )
  const userColumns = new Set(
    (driver.prepare('PRAGMA table_info(user)').all() as Array<{ name: string }>).map(
      ({ name }) => name,
    ),
  )
  const missingTables = [
    'user',
    'session',
    'account',
    'verification',
    'twoFactor',
    'project',
    'credential',
    'codex_event',
  ].filter((table) => !tables.has(table))
  const hasLegacyMigrationTable = tables.has('schema_migrations')
  if (
    missingTables.length > 0 ||
    !userColumns.has('two_factor_enabled') ||
    hasLegacyMigrationTable
  ) {
    throw new Error(
      'Owner database schema is missing current tables or columns. Run `pnpm db:push` to recreate it.',
    )
  }
}

export type Database = ReturnType<typeof createDatabase>['db']
