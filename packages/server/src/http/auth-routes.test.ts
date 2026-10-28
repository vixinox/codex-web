import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOwnerServer } from '../owner/app.js'
import type { ServerConfig } from '../config.js'
import type { AppDependencies } from './types.js'

const config = {
  host: '127.0.0.1',
  port: 3000,
  authSecret: 'test-secret-that-is-at-least-32-characters',
  authUrl: 'http://127.0.0.1:3000',
  trustedOrigins: ['http://localhost:5173'],
  enforceOriginChecks: true,
  dataRoot: '.data/test',
  maxActiveTasksPerUser: 1,
  credentialEncryptionKey: 'test-key',
  allowedOutboundSchemes: ['https'],
  allowedOutboundHosts: ['api.example.test'],
} satisfies ServerConfig

function dependencies(ownerExists: () => boolean) {
  const calls: string[] = []
  const auth = {
    handler: async (request: Request) => {
      calls.push(new URL(request.url).pathname)
      return new Response(JSON.stringify({ path: new URL(request.url).pathname }), {
        headers: { 'content-type': 'application/json' },
      })
    },
    api: {},
  }
  const workspace = {
    hasOwner: async () => ownerExists(),
    isOwnerSecurityInitialized: async () => true,
    acknowledgeOwnerRecoveryCodes: async () => true,
  }
  const codex = { events: { latestEventId: () => 0, subscribe: () => () => undefined } }
  return { dependencies: { auth, workspace, codex } as unknown as AppDependencies, calls }
}

test('forwards Better Auth session requests and allows only first local signup', async () => {
  let ownerExists = false
  const { dependencies: deps, calls } = dependencies(() => ownerExists)
  const app = await buildOwnerServer(config, deps)
  try {
    const session = await app.inject({ method: 'GET', url: '/api/auth/get-session' })
    assert.equal(session.statusCode, 200)
    assert.deepEqual(session.json(), { path: '/api/auth/get-session' })

    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:5173' },
      payload: { name: 'Owner', email: 'owner@example.test', password: 'correct-horse-battery' },
    })
    assert.equal(signup.statusCode, 200)
    assert.deepEqual(calls, ['/api/auth/get-session', '/api/auth/sign-up/email'])

    ownerExists = true
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:5173' },
      payload: { name: 'Other', email: 'other@example.test', password: 'correct-horse-battery' },
    })
    assert.equal(duplicate.statusCode, 409)
    assert.equal(calls.length, 2)

    const remote = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:5173', 'x-codex-web-remote': '1' },
      payload: { name: 'Remote', email: 'remote@example.test', password: 'correct-horse-battery' },
    })
    assert.equal(remote.statusCode, 403)
    assert.equal(calls.length, 2)
  } finally {
    await app.close()
  }
})

test('owner security setup routes require a local authenticated session', async () => {
  const calls: string[] = []
  const setupBodies: unknown[] = []
  const auth = {
    handler: async () => new Response('{}'),
    api: {
      getSession: async () => ({ user: { id: 'owner-1' }, session: { id: 'session-1' } }),
      enableTwoFactor: async (input: { body: unknown }) => {
        calls.push('setup')
        setupBodies.push(input.body)
        return { totpURI: 'otpauth://totp/example', backupCodes: ['one', 'two'] }
      },
      verifyTOTP: async () => {
        calls.push('verify')
        return Response.json(
          { token: 'fresh-token', user: { id: 'owner-1', twoFactorEnabled: true } },
          { headers: { 'set-cookie': 'session=new-session; Path=/; HttpOnly' } },
        )
      },
    },
  }
  const deps = {
    auth,
    workspace: {
      hasOwner: async () => true,
      isOwnerSecurityInitialized: async () => false,
      acknowledgeOwnerRecoveryCodes: async () => true,
    },
    codex: { events: { latestEventId: () => 0, subscribe: () => () => undefined } },
  } as unknown as AppDependencies
  const app = await buildOwnerServer(config, deps)
  try {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/owner-security/setup',
      headers: { origin: 'http://localhost:5173' },
      payload: { password: 'owner-password' },
    })
    assert.equal(setup.statusCode, 200)
    assert.deepEqual(setup.json(), {
      totpURI: 'otpauth://totp/example',
      backupCodes: ['one', 'two'],
    })
    assert.deepEqual(setupBodies, [
      { password: 'owner-password', method: 'totp', issuer: 'Codex Web' },
    ])

    const missingPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/owner-security/setup',
      headers: { origin: 'http://localhost:5173' },
      payload: {},
    })
    assert.equal(missingPassword.statusCode, 400)
    assert.deepEqual(calls, ['setup'])

    const remote = await app.inject({
      method: 'POST',
      url: '/api/auth/owner-security/setup',
      headers: { origin: 'http://localhost:5173', 'x-codex-web-remote': '1' },
      payload: {},
    })
    assert.equal(remote.statusCode, 403)

    const verify = await app.inject({
      method: 'POST',
      url: '/api/auth/owner-security/verify',
      headers: { origin: 'http://localhost:5173' },
      payload: { code: '123456' },
    })
    assert.equal(verify.statusCode, 200)
    assert.deepEqual(verify.json(), {
      token: 'fresh-token',
      user: { id: 'owner-1', twoFactorEnabled: true },
    })
    assert.equal(
      (verify.headers['set-cookie'] as string[])[0],
      'session=new-session; Path=/; HttpOnly',
    )
    assert.deepEqual(calls, ['setup', 'verify'])
  } finally {
    await app.close()
  }
})

test('owner setup acknowledgement requires verified TOTP and is persisted server-side', async () => {
  const acknowledgements: string[] = []
  const auth = {
    handler: async () => new Response('{}'),
    api: {
      getSession: async () => ({
        user: { id: 'owner-1', twoFactorEnabled: true },
        session: { id: 'session-1' },
      }),
      viewBackupCodes: async () => ({ status: true, backupCodes: ['one'] }),
    },
  }
  const deps = {
    auth,
    workspace: {
      hasOwner: async () => true,
      isOwnerSecurityInitialized: async () => false,
      acknowledgeOwnerRecoveryCodes: async (id: string) => {
        acknowledgements.push(id)
        return true
      },
    },
    codex: { events: { latestEventId: () => 0, subscribe: () => () => undefined } },
  } as unknown as AppDependencies
  const app = await buildOwnerServer(config, deps)
  try {
    const complete = await app.inject({
      method: 'POST',
      url: '/api/auth/owner-security/complete',
      headers: { origin: 'http://localhost:5173' },
      payload: {},
    })
    assert.equal(complete.statusCode, 200)
    assert.deepEqual(complete.json(), { initialized: true })
    assert.deepEqual(acknowledgements, ['owner-1'])
  } finally {
    await app.close()
  }
})
