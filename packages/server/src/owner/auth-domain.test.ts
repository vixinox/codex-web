import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ServerConfig } from '../config.js'
import { createDatabase, prepareOwnerDatabase } from '../database.js'
import { owner } from '../db/schema.js'
import { createOwnerAuthDomain, AuthDomainError } from './auth-domain.js'

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

test('remote sessions bind to devices and revoke on device removal', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-auth-session-'))
  try {
    prepareOwnerDatabase(config(dataRoot))
    const database = createDatabase(config(dataRoot))
    const ownerId = 'owner-session-test'
    database.db.insert(owner).values({ id: ownerId }).run()
    const domain = createOwnerAuthDomain(database.db, ownerId)
    await domain.registerDevice('device-1', 'public-key-1')
    const session = await domain.createSession('device-1')
    assert.equal((await domain.resume(session.token)).sessionId, session.sessionId)
    await domain.markDeviceRevoked('device-1')
    await assert.rejects(
      domain.resume(session.token),
      (error: unknown) =>
        error instanceof AuthDomainError && error.code === 'owner.auth.session-revoked',
    )
    database.driver.close()
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('requires a registered credential before creating authentication options', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-auth-requires-passkey-'))
  let database: ReturnType<typeof createDatabase> | undefined
  try {
    prepareOwnerDatabase(config(dataRoot))
    database = createDatabase(config(dataRoot))
    const ownerId = 'owner-discoverable-test'
    database.db.insert(owner).values({ id: ownerId }).run()
    const domain = createOwnerAuthDomain(database.db, ownerId)

    await assert.rejects(
      domain.authenticationOptions('local', {
        connectionId: 'local-login',
        clientPublicKey: 'local',
      }),
      (error: unknown) =>
        error instanceof AuthDomainError && error.code === 'owner.auth.passkey-required',
    )
  } finally {
    database?.driver.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('preserves registration verification causes for server diagnostics', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-auth-registration-cause-'))
  let database: ReturnType<typeof createDatabase> | undefined
  try {
    prepareOwnerDatabase(config(dataRoot))
    database = createDatabase(config(dataRoot))
    const ownerId = 'owner-registration-cause-test'
    database.db.insert(owner).values({ id: ownerId }).run()
    const domain = createOwnerAuthDomain(database.db, ownerId)
    const binding = { connectionId: 'remote-registration', clientPublicKey: 'client-key' }
    const options = await domain.registerOptions('remote', binding)

    await assert.rejects(
      domain.register(options.challengeId, {} as never, { ...binding, profile: 'remote' }),
      (error: unknown) =>
        error instanceof AuthDomainError &&
        error.code === 'owner.auth.passkey-invalid' &&
        error.cause instanceof Error &&
        error.cause.message.length > 0,
    )
  } finally {
    database?.driver.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
