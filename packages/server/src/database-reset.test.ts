import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateKeyPair, serializePublicKey } from '@codex-web/protocol/relay/crypto'
import { createDatabase, prepareOwnerDatabase } from './database.js'
import { resetOwnerDatabase } from './database-reset.js'
import type { ServerConfig } from './config.js'
import {
  acquireOwnerInstanceLock,
  OwnerInstanceAlreadyRunningError,
} from './owner/instance-lock.js'
import { RemoteTrustStore } from './remote/trust-store.js'
import { owner } from './db/schema.js'

function config(dataRoot: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    appOrigin: 'https://app.example.test',
    rpId: 'app.example.test',
    trustedOrigins: ['https://app.example.test', 'http://localhost:5173', 'http://127.0.0.1:5173'],
    dataRoot,
    credentialEncryptionKey: 'test-key',
  }
}

test('database reset clears Owner data and remote peers while preserving node identity and Codex files', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'codex-owner-reset-'))
  const codexHome = path.join(dataRoot, 'codex-home')
  await mkdir(codexHome)
  await writeFile(path.join(codexHome, 'history.jsonl'), 'preserve me')
  const serverConfig = config(dataRoot)
  let database: ReturnType<typeof createDatabase> | undefined
  try {
    prepareOwnerDatabase(serverConfig)
    database = createDatabase(serverConfig)
    database.db.insert(owner).values({ id: 'owner-before-reset' }).run()
    database.driver.close()
    database = undefined

    const trust = new RemoteTrustStore(dataRoot)
    await trust.load()
    const identityBefore = await trust.identity()
    const deviceKeys = await generateKeyPair()
    await trust.trustPeer(await serializePublicKey(deviceKeys.publicKey))
    await writeFile(path.join(dataRoot, 'owner.sqlite-wal'), 'stale wal')
    await writeFile(path.join(dataRoot, 'owner.sqlite-shm'), 'stale shm')

    await resetOwnerDatabase(serverConfig, { trustStore: trust })
    database = createDatabase(serverConfig)
    assert.equal(database.db.select().from(owner).all().length, 0)
    assert.deepEqual(await trust.listPeers(), [])
    const identityAfter = await trust.identity()
    assert.equal(identityAfter.nodeId, identityBefore.nodeId)
    assert.equal(identityAfter.trustEpoch, identityBefore.trustEpoch)
    assert.equal(identityAfter.ownerPublicKey, identityBefore.ownerPublicKey)
    assert.equal(await readFile(path.join(codexHome, 'history.jsonl'), 'utf8'), 'preserve me')
  } finally {
    database?.driver.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('reset remains blocked by the Owner instance lock and leaves the database intact', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'codex-owner-reset-lock-'))
  const serverConfig = config(dataRoot)
  let database: ReturnType<typeof createDatabase> | undefined
  let lock: Awaited<ReturnType<typeof acquireOwnerInstanceLock>> | undefined
  try {
    prepareOwnerDatabase(serverConfig)
    database = createDatabase(serverConfig)
    database.db.insert(owner).values({ id: 'owner-lock-test' }).run()
    database.driver.close()
    database = undefined
    lock = await acquireOwnerInstanceLock(dataRoot)
    await assert.rejects(acquireOwnerInstanceLock(dataRoot), OwnerInstanceAlreadyRunningError)
    database = createDatabase(serverConfig)
    assert.equal(database.db.select().from(owner).all()[0]?.id, 'owner-lock-test')
  } finally {
    database?.driver.close()
    await lock?.release()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
