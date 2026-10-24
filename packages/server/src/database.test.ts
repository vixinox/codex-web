import assert from 'node:assert/strict'
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

test('creates a versioned SQLite database idempotently with foreign keys enabled', () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-web-sqlite-'))
  try {
    const first = createDatabase(config(dataRoot))
    assert.equal(first.driver.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(first.driver.prepare('SELECT version FROM schema_migrations').pluck().get(), 1)
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

    const second = createDatabase(config(dataRoot))
    assert.equal(second.driver.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get(), 1)
    second.driver.close()
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
