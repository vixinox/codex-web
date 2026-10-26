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
  const workspace = { hasOwner: async () => ownerExists() }
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
