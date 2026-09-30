import assert from 'node:assert/strict'
import test from 'node:test'
import { createHttpServer } from './server-base.js'

test('rejects state-changing requests from untrusted origins', async () => {
  const app = await createHttpServer({
    trustedOrigins: ['https://codex.example.com'],
    enforceOriginChecks: true,
  })
  app.post('/write', async () => ({ ok: true }))

  const rejected = await app.inject({
    method: 'POST',
    url: '/write',
    headers: { origin: 'https://attacker.example.com' },
  })
  assert.equal(rejected.statusCode, 403)
  assert.deepEqual(rejected.json(), {
    error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed' },
  })

  const accepted = await app.inject({
    method: 'POST',
    url: '/write',
    headers: { origin: 'https://codex.example.com' },
  })
  assert.equal(accepted.statusCode, 200)
  await app.close()
})

test('does not log SSE responses', async () => {
  const app = await createHttpServer()
  app.get('/api/events', async () => ({ ok: true }))
  const output: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => output.push(args.join(' '))
  try {
    const response = await app.inject({ method: 'GET', url: '/api/events' })
    assert.equal(response.statusCode, 200)
  } finally {
    console.error = originalError
    await app.close()
  }
  assert.deepEqual(output, [])
})
