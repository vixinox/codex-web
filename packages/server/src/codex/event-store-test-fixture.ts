import DatabaseDriver from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

export function openEventStoreTestDatabase(databasePath: string) {
  const driver = new DatabaseDriver(databasePath)
  driver.pragma('foreign_keys = ON')
  driver.exec(`
    CREATE TABLE IF NOT EXISTS owner (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      runtime_initialized_at INTEGER,
      current_credential_id TEXT
    );
    CREATE TABLE IF NOT EXISTS conversation_events (
      id INTEGER PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL REFERENCES owner(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL,
      change TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_events_owner_conversation_id_idx
      ON conversation_events(owner_id, conversation_id, id);
  `)
  const db = drizzle({ client: driver })
  return { db, driver }
}
