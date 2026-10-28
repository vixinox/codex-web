import assert from 'node:assert/strict'
import DatabaseDriver from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { ServerConfig } from './config.js'
import { createDatabase } from './database.js'

function config(dataRoot: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    authSecret: 'test-secret-that-is-at-least-32-characters',
    authUrl: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://localhost:5173'],
    dataRoot,
    maxActiveTasksPerUser: 2,
    credentialEncryptionKey: 'test-key',
    allowedOutboundSchemes: ['https'],
    allowedOutboundHosts: ['api.example.com'],
  }
}

test('creates the current SQLite schema and rejects legacy version tracking', () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-web-sqlite-'))
  try {
    const initial = new DatabaseDriver(path.join(dataRoot, 'owner.sqlite'))
    initial.exec(`
      CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, current_credential_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, two_factor_enabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE session (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
      CREATE TABLE account (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE verification (id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE twoFactor (id TEXT PRIMARY KEY NOT NULL, secret TEXT NOT NULL, backup_codes TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, verified INTEGER NOT NULL DEFAULT 1, failed_verification_count INTEGER, locked_until INTEGER);
      CREATE TABLE project (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE credential (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, provider TEXT NOT NULL, base_url TEXT NOT NULL, encrypted_api_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE codex_event (id INTEGER PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, thread_id TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE owner_security_state (owner_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE, recovery_codes_acknowledged_at INTEGER);
    `)
    initial.close()
    const first = createDatabase(config(dataRoot))
    assert.equal(first.driver.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(
      first.driver
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .pluck()
        .get(),
      undefined,
    )
    assert.deepEqual(
      (first.driver.prepare('PRAGMA table_info(user)').all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
      [
        'id',
        'name',
        'email',
        'email_verified',
        'image',
        'current_credential_id',
        'created_at',
        'updated_at',
        'two_factor_enabled',
      ],
    )
    assert.equal(
      first.driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'twoFactor'")
        .pluck()
        .get(),
      'twoFactor',
    )
    assert.equal(
      first.driver
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'owner_security_state'",
        )
        .pluck()
        .get(),
      'owner_security_state',
    )
    first.driver
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Owner', 'owner@example.test', 0, 1, 1)",
      )
      .run()
    first.driver
      .prepare(
        "INSERT INTO project (id, user_id, name, path, created_at, updated_at) VALUES ('project', 'owner', 'Project', '/project', 1, 1)",
      )
      .run()
    first.driver.prepare("DELETE FROM user WHERE id = 'owner'").run()
    assert.equal(first.driver.prepare('SELECT COUNT(*) AS count FROM project').pluck().get(), 0)
    first.driver.close()
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('rejects a legacy database instead of silently applying old schema behavior', () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-web-sqlite-v1-'))
  try {
    const legacyDriver = new DatabaseDriver(path.join(dataRoot, 'owner.sqlite'))
    legacyDriver.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, current_credential_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);',
    )
    legacyDriver.close()
    assert.throws(
      () => createDatabase(config(dataRoot)),
      /schema is missing current tables or columns/,
    )
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
