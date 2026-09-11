import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

import { GuestLeaseStore, guestRuntimeSkeleton } from './guest.js'
import { startGuestRuntime } from './guest/startup.js'
import { createHttpServer } from './http/server-base.js'
import { registerGuestRoutes } from './http/guest-routes.js'

let guestSessionUser = 'guest-user'
const ownerDependencies = {
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const cookie = headers.get('cookie')
        if (!cookie) return null
        const userId = cookie.split('session=')[1]?.split(';')[0]
        return userId === guestSessionUser
          ? { user: { id: userId, kind: 'guest', isAnonymous: true } }
          : null
      },
      signInAnonymous: async () => {
        guestSessionUser = `guest-${Date.now()}`
        return new Response(JSON.stringify({ user: { id: guestSessionUser } }), {
          headers: { 'set-cookie': `session=${guestSessionUser}` },
        })
      },
    },
  },
  workspace: {},
  codex: { events: {} },
  guest: {
    runtime: () => guestRuntimeSkeleton,
    startSession: async (userId: string) => ({
      identity: { id: `lease-${userId}`, userId, expiresAt: new Date(Date.now() + 86_400_000) },
    }),
    session: async (userId: string) => ({
      id: `lease-${userId}`,
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    }),
    reset: async () => undefined,
  },
} as never
const testDependencies = ownerDependencies as unknown as {
  auth: unknown
  guest: import('./guest-service.js').GuestService
}

test('guest leases are opaque, short-lived identities rather than owner users', () => {
  const leases = new GuestLeaseStore()
  const now = Date.UTC(2026, 8, 8, 0, 0, 0)
  const created = leases.create(now)

  assert.match(created.id, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(leases.read(created.id, now), created)
  assert.ok(leases.read(created.id, now + 1000 * 60 * 60 * 4))
  assert.equal(leases.read(created.id, now + 1000 * 60 * 60 * 24), null)
})

test('reset revokes the prior guest lease and produces a distinct capability', () => {
  const leases = new GuestLeaseStore()
  const prior = leases.create()
  const replacement = leases.reset(prior.id)

  assert.notEqual(replacement.id, prior.id)
  assert.equal(leases.read(prior.id), null)
  assert.equal(leases.read(replacement.id), replacement)
})

test('guest test fallback declares the same restricted workspace boundary as production', () => {
  assert.deepEqual(guestRuntimeSkeleton, {
    kind: 'guest-runtime',
    maxActiveThreads: 5,
    modelContextWindow: 256_000,
    sandbox: 'workspaceWrite',
    network: 'disabled',
    status: 'not-configured',
  })
})

test('guest startup prepares the verified runtime before starting the process', async () => {
  const calls: string[] = []
  await startGuestRuntime(
    { ensureRuntime: async () => void calls.push('ensure') },
    async () => void calls.push('start'),
  )
  assert.deepEqual(calls, ['ensure', 'start'])
})

test('guest startup fails closed when runtime preparation fails', async () => {
  let processStarted = false
  await assert.rejects(
    () =>
      startGuestRuntime(
        {
          ensureRuntime: async () => {
            throw new Error('runtime unavailable')
          },
        },
        async () => void (processStarted = true),
      ),
    /runtime unavailable/,
  )
  assert.equal(processStarted, false)
})

test('guest HTTP routes issue, restore, and reset a lease without owner authentication', async () => {
  const app = await createHttpServer()
  await registerGuestRoutes(app, {
    dependencies: { guest: testDependencies.guest },
    auth: testDependencies.auth as never,
  })
  try {
    const started = await app.inject({ method: 'POST', url: '/guest-api/session' })
    assert.equal(started.statusCode, 200)
    assert.deepEqual(started.json().runtime, guestRuntimeSkeleton)
    const initialCookie = started.headers['set-cookie']
    assert.ok(initialCookie)

    const restored = await app.inject({
      method: 'GET',
      url: '/guest-api/session',
      headers: { cookie: Array.isArray(initialCookie) ? initialCookie[0] : initialCookie },
    })
    assert.equal(restored.statusCode, 200)

    const reset = await app.inject({
      method: 'POST',
      url: '/guest-api/reset',
      headers: { cookie: Array.isArray(initialCookie) ? initialCookie[0] : initialCookie },
    })
    assert.equal(reset.statusCode, 200)
    const resetCookie = reset.headers['set-cookie']
    assert.ok(resetCookie)
    assert.notEqual(resetCookie, initialCookie)

    const revoked = await app.inject({
      method: 'GET',
      url: '/guest-api/session',
      headers: { cookie: Array.isArray(initialCookie) ? initialCookie[0] : initialCookie },
    })
    assert.equal(revoked.statusCode, 401)
  } finally {
    await app.close()
  }
})

test('guest SSE route delegates cleanup ownership to startSseStream', async () => {
  const source = await fs.readFile(new URL('./http/guest-routes.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /reply\.raw\.on\(['"]error['"],\s*cleanup\)/)
})
