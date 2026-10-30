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

test('recovery codes reserve, consume once, and rotate transactionally', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-auth-domain-'))
  try {
    prepareOwnerDatabase(config(dataRoot))
    const database = createDatabase(config(dataRoot))
    const ownerId = 'owner-test'
    database.db.insert(owner).values({ id: ownerId }).run()
    const domain = createOwnerAuthDomain(database.db, ownerId)
    const codes = await domain.generateRecoveryCodes()
    const reservation = await domain.reserveRecoveryCode(codes[0])
    await assert.rejects(
      domain.reserveRecoveryCode(codes[0]),
      (error: unknown) =>
        error instanceof AuthDomainError && error.code === 'RECOVERY_CODE_RESERVED',
    )
    const rotated = await domain.finishRecoveryReservation(reservation.challengeId, true)
    assert.equal(rotated.completed, true)
    assert.equal(rotated.recoveryCodes?.length, 10)
    await assert.rejects(domain.consumeRecoveryCode(codes[0]), /RECOVERY_CODE_INVALID/u)
    database.driver.close()
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

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
      (error: unknown) => error instanceof AuthDomainError && error.code === 'SESSION_REVOKED',
    )
    database.driver.close()
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
