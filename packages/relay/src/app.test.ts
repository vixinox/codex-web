import test from 'node:test'
import assert from 'node:assert/strict'

import { RelayRouter } from './relay-router.js'
import { createRelayApp } from './app.js'

test('owner-code lookup is readable cross-origin and never cached', async () => {
  const { app } = createRelayApp(new RelayRouter({ ownerToken: 'x'.repeat(32) }), {
    upgradeWebSocket: (() => async () => new Response()) as never,
    websocket: {} as never,
  })
  const response = await app.request('/owner-code/123456789', {
    headers: { origin: 'https://app.example.test' },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { online: false })

  const preflight = await app.request('/owner-code/123456789', { method: 'OPTIONS' })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS')
})
