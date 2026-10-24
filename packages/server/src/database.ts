import DatabaseDriver from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import type { ServerConfig } from './config.js'

export function createDatabase(config: ServerConfig) {
  mkdirSync(config.dataRoot, { recursive: true })
  const driver = new DatabaseDriver(path.join(config.dataRoot, 'owner.sqlite'))
  driver.pragma('foreign_keys = ON')
  driver.pragma('busy_timeout = 5000')
  driver.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)',
  )
  const current = driver.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
    | { version: number | null }
    | undefined
  if (!current?.version || current.version < 1) {
    const applyInitialMigration = driver.transaction(() => {
      driver.exec(`
    CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, current_credential_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS credential (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, provider TEXT NOT NULL, base_url TEXT NOT NULL, encrypted_api_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS codex_event (id INTEGER PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, thread_id TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS session_userId_idx ON session(user_id);
    CREATE INDEX IF NOT EXISTS account_userId_idx ON account(user_id);
    CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
    CREATE INDEX IF NOT EXISTS project_userId_idx ON project(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS project_userId_name_unique ON project(user_id, name);
    CREATE UNIQUE INDEX IF NOT EXISTS project_userId_path_unique ON project(user_id, path);
    CREATE INDEX IF NOT EXISTS credential_userId_idx ON credential(user_id);
    CREATE INDEX IF NOT EXISTS codex_event_user_id_idx ON codex_event(user_id);
    CREATE INDEX IF NOT EXISTS codex_event_user_id_id_idx ON codex_event(user_id, id);
    CREATE INDEX IF NOT EXISTS codex_event_user_id_thread_id_id_idx ON codex_event(user_id, thread_id, id);
      `)
      driver
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(1, Date.now())
    })
    applyInitialMigration()
  }
  const db = drizzle({ client: driver })

  return { db, driver }
}

export type Database = ReturnType<typeof createDatabase>['db']
