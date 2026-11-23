import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { isoCBOR } from '@simplewebauthn/server/helpers'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ServerConfig } from '../config.js'
import { createDatabase, prepareOwnerDatabase } from '../database.js'
import { owner, ownerSession } from '../db/schema.js'
import { createOwnerAuthDomain, AuthDomainError, WEBAUTHN_PROFILES } from './auth-domain.js'
import { createOwnerApplicationServices } from './application-services.js'
import type { OwnerAdmission, OwnerMethodContext } from './session-runtime.js'

test('browser challenges round-trip through Passkey registration and authentication', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-auth-passkey-'))
  let database: ReturnType<typeof createDatabase> | undefined
  try {
    prepareOwnerDatabase(config(dataRoot))
    database = createDatabase(config(dataRoot))
    const ownerId = 'owner-passkey-test'
    database.db.insert(owner).values({ id: ownerId }).run()
    const domain = createOwnerAuthDomain(database.db, ownerId)
    const services = createOwnerApplicationServices(
      { database: database.db, ownerId, workspace: {} as never, codex: {} as never },
      { trustedOrigins: [] },
    )
    for (const profile of ['remote', 'local'] as const) {
      const { origin, rpId } = WEBAUTHN_PROFILES[profile]
      const binding = { profile, connectionId: `${profile}-passkey`, clientPublicKey: 'client-key' }
      const ticket =
        profile === 'local' ? (await domain.issueLocalEnrollmentTicket()).ticket : undefined
      const registration = await domain.registerOptions(profile, binding, ticket)
      const { publicKey, privateKey } = generateKeyPairSync('ed25519')
      const jwk = publicKey.export({ format: 'jwk' })
      assert.ok(jwk.x)
      const credentialId = Buffer.from(`${profile}-credential`)
      const id = credentialId.toString('base64url')
      const coseKey = isoCBOR.encode(
        new Map<number, number | Uint8Array>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, Buffer.from(jwk.x, 'base64url')],
        ]),
      )
      const rpIdHash = createHash('sha256').update(rpId).digest()
      const credentialLength = Buffer.alloc(2)
      credentialLength.writeUInt16BE(credentialId.length)
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([0x45]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        credentialLength,
        credentialId,
        coseKey,
      ])
      const clientData = (type: string, challenge: string) =>
        Buffer.from(
          JSON.stringify({
            type,
            // A browser encodes the challenge bytes supplied by the JSON options.
            challenge: Buffer.from(challenge, 'base64url').toString('base64url'),
            origin,
          }),
        )
      const response = {
        id,
        rawId: id,
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData('webauthn.create', registration.options.challenge).toString(
            'base64url',
          ),
          attestationObject: Buffer.from(
            isoCBOR.encode(
              new Map<string, string | Uint8Array | Map<string, never>>([
                ['fmt', 'none'],
                ['authData', authData],
                ['attStmt', new Map()],
              ]),
            ),
          ).toString('base64url'),
        },
      }
      assert.deepEqual(
        await domain.register(registration.challengeId, response, { ...binding, ticket }),
        { registered: true },
      )
      assert.equal(await domain.hasPasskey(profile), true)
      const configuredOwner = database.db.select().from(owner).get()
      assert.ok(
        profile === 'remote'
          ? configuredOwner?.remotePasskeyConfiguredAt
          : configuredOwner?.localPasskeyConfiguredAt,
      )
      await assert.rejects(
        domain.register(registration.challengeId, response, { ...binding, ticket }),
      )

      if (profile === 'remote')
        await domain.registerDevice('device-passkey', binding.clientPublicKey)
      let admission: OwnerAdmission | undefined
      const context: OwnerMethodContext = {
        owner: null,
        connectionId: binding.connectionId,
        transport: {
          kind: profile === 'remote' ? 'relay' : 'local',
          origin,
          clientPublicKey: binding.clientPublicKey,
          ...(profile === 'remote' ? { e2eeVerified: true, pairedDeviceId: 'device-passkey' } : {}),
          send() {},
          close() {},
          onMessage: () => () => {},
          onClose: () => () => {},
        },
        signal: new AbortController().signal,
        requestId: 'passkey-login',
        authenticate(value) {
          admission = value
        },
        unauthenticate() {},
      }
      const authentication = await services.passkeyAuthenticationOptions(context)
      const assertionData = clientData('webauthn.get', authentication.options.challenge)
      const counter = Buffer.alloc(4)
      counter.writeUInt32BE(1)
      const assertionAuthData = Buffer.concat([rpIdHash, Buffer.from([0x05]), counter])
      const signature = sign(
        null,
        Buffer.concat([assertionAuthData, createHash('sha256').update(assertionData).digest()]),
        privateKey,
      )
      const assertion = {
        id,
        rawId: id,
        type: 'public-key' as const,
        clientExtensionResults: {},
        response: {
          clientDataJSON: assertionData.toString('base64url'),
          authenticatorData: assertionAuthData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      }
      const session = await services.passkeyAuthenticate(context, {
        challengeId: authentication.challengeId,
        response: assertion,
      })
      assert.ok(session.token)
      assert.equal(admission?.ownerId, ownerId)
      assert.equal('ownerId' in session ? session.ownerId : undefined, ownerId)
      const resumed = await services.resumeSession(session.token, context.transport)
      assert.equal(resumed?.ownerId, ownerId)
      assert.equal(resumed?.sessionToken, session.token)
      if (profile === 'local') {
        assert.equal(
          await services.resumeSession(session.token, {
            ...context.transport,
            kind: 'relay',
            pairedDeviceId: 'device-passkey',
            e2eeVerified: true,
          }),
          null,
        )
        assert.equal(
          (await services.resumeSession(session.token, context.transport))?.ownerId,
          ownerId,
        )
      }
      await assert.rejects(
        services.passkeyAuthenticate(context, {
          challengeId: authentication.challengeId,
          response: assertion,
        }),
      )
    }
  } finally {
    database?.driver.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

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

test('device removal revokes remote sessions while all-device removal preserves local sessions', async () => {
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
    const local = await domain.createSession()
    await domain.registerDevice('device-2', 'public-key-2')
    const otherRemote = await domain.createSession('device-2')
    await domain.revokeAllDevices()
    await assert.rejects(domain.resume(otherRemote.token))
    await assert.rejects(domain.createSession('device-2'))
    const storedLocal = database.db
      .select()
      .from(ownerSession)
      .all()
      .find((row) => row.id === local.sessionId)
    assert.equal(storedLocal?.revokedAt, null)
    assert.equal((await domain.resume(local.token)).sessionId, local.sessionId)
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
