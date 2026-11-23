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
    credentialEncryptionKey: 'test-key',
  }
}

test('creates the current Owner schema with the Conversation event index', () => {
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
      'remote_device',
      'owner_session',
      'project',
      'credential',
      'conversation_events',
    ])
      assert.ok(names.includes(name), `missing ${name}`)
    assert.ok(!names.includes('local_enrollment_ticket'))
    for (const name of [
      'user',
      'account',
      'verification',
      'twoFactor',
      'owner_security_state',
      'domain_events',
    ])
      assert.ok(!names.includes(name), `unexpected legacy table ${name}`)
    assert.deepEqual(
      database.driver
        .prepare("SELECT name FROM pragma_table_info('conversation_events') ORDER BY cid")
        .pluck()
        .all(),
      ['id', 'owner_id', 'conversation_id', 'change', 'created_at'],
    )
    assert.deepEqual(
      database.driver
        .prepare(
          "SELECT name FROM pragma_index_info('conversation_events_owner_conversation_id_idx') ORDER BY seqno",
        )
        .pluck()
        .all(),
      ['owner_id', 'conversation_id', 'id'],
    )
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

test('rejects a legacy event table even when the current tables are present', () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-owner-event-cutover-'))
  try {
    const serverConfig = config(dataRoot)
    prepareOwnerDatabase(serverConfig)
    const driver = new DatabaseDriver(path.join(dataRoot, 'owner.sqlite'))
    try {
      driver.exec(
        'CREATE TABLE domain_events (id INTEGER PRIMARY KEY); INSERT INTO domain_events VALUES (7)',
      )
      prepareOwnerDatabase(serverConfig)
      assert.throws(() => createDatabase(serverConfig), /pnpm db:reset/u)
      assert.equal(driver.prepare('SELECT id FROM domain_events').pluck().get(), 7)
    } finally {
      driver.close()
    }
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
