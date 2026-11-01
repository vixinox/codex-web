import assert from 'node:assert/strict'
import DatabaseDriver from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ServerConfig } from './config.js'
import { createDatabase, prepareOwnerDatabase } from './database.js'

function config(dataRoot: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    trustedOrigins: ['http://localhost:5173'],
    dataRoot,
    maxActiveTasksPerUser: 2,
    credentialEncryptionKey: 'test-key',
    allowedOutboundSchemes: ['https'],
    allowedOutboundHosts: ['api.example.com'],
  }
}

test('creates the Owner schema and rejects legacy authentication tables', () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-owner-db-'))
  try {
    prepareOwnerDatabase(config(dataRoot))
    const database = createDatabase(config(dataRoot))
    const names = (
      database.driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map((x) => x.name)
    for (const name of [
      'owner',
      'passkey_credential',
      'local_enrollment_ticket',
      'remote_device',
      'owner_session',
      'project',
      'credential',
      'domain_events',
    ])
      assert.ok(names.includes(name), `missing ${name}`)
    for (const name of ['user', 'account', 'verification', 'twoFactor', 'owner_security_state'])
      assert.ok(!names.includes(name), `unexpected legacy table ${name}`)
    assert.equal(database.driver.pragma('foreign_keys', { simple: true }), 1)
    database.driver.close()
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('rejects a legacy database instead of applying the Owner schema implicitly', () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-owner-legacy-'))
  try {
    const driver = new DatabaseDriver(path.join(dataRoot, 'owner.sqlite'))
    driver.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)')
    driver.close()
    assert.throws(() => createDatabase(config(dataRoot)), /pnpm db:reset/u)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
