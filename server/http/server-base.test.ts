import assert from 'node:assert/strict'
import test from 'node:test'
import { createHttpServer } from './server-base.js'

test('rejects state-changing requests from untrusted origins in proxy mode', async () => {
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
