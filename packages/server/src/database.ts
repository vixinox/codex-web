import DatabaseDriver from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { fileURLToPath } from 'node:url'

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

export function prepareOwnerDatabase(config: ServerConfig) {
  mkdirSync(config.dataRoot, { recursive: true })
  const databasePath = path.join(config.dataRoot, 'owner.sqlite')
  if (existsSync(databasePath)) return

  const drizzleConfig = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../drizzle.config.ts',
  )
  const serverRoot = path.dirname(drizzleConfig)
  const packageJsonPath = path.join(serverRoot, 'node_modules', 'drizzle-kit', 'package.json')
  const packageInfo = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    bin?: Record<string, string> | string
  }
  const bin =
    typeof packageInfo.bin === 'string' ? packageInfo.bin : packageInfo.bin?.['drizzle-kit']
  if (!bin) throw new Error('Could not locate drizzle-kit executable.')
  const executable = path.resolve(path.dirname(packageJsonPath), bin)
  const result = spawnSync(process.execPath, [executable, 'push', '--config', drizzleConfig], {
    cwd: path.dirname(drizzleConfig),
    env: { ...process.env, CODEX_DATA_ROOT: config.dataRoot },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Could not prepare the Owner database schema.')
}

function assertCurrentSchema(driver: DatabaseDriver.Database) {
  const tables = new Set(
    (
      driver.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map(({ name }) => name),
  )
  const missingTables = [
    'owner',
    'passkey_credential',
    'recovery_code',
    'local_enrollment_ticket',
    'remote_device',
    'owner_session',
    'auth_throttle',
    'project',
    'credential',
    'codex_event',
  ].filter((table) => !tables.has(table))
  const legacyTables = ['user', 'session', 'account', 'verification', 'twoFactor', 'owner_security_state']
    .filter((table) => tables.has(table))
  const hasLegacyMigrationTable = tables.has('schema_migrations')
  if (missingTables.length > 0 || legacyTables.length > 0 || hasLegacyMigrationTable) {
    throw new Error(
      'Owner database schema is missing the current Owner tables or still contains legacy authentication data. Run `pnpm db:reset` to explicitly recreate it.',
    )
  }
}

export type Database = ReturnType<typeof createDatabase>['db']
