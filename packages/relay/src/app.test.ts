import test from 'node:test'
import assert from 'node:assert/strict'

import { RelayRouter } from './relay-router.js'
import { createRelayApp } from './app.js'
import { TelemetryErrorCode } from '@codex-web/telemetry/errors'
import { createLogger, type LogRecord } from '@codex-web/telemetry/logger'
import { RELAY_PROTOCOL_VERSION } from '@codex-web/protocol/relay'

test('does not expose the internal owner routing code over HTTP', async () => {
  const { app } = createRelayApp(new RelayRouter({ ownerToken: 'x'.repeat(32) }), {
    upgradeWebSocket: (() => async () => new Response()) as never,
    websocket: {} as never,
  })
  const response = await app.request('/owner-code/123456789', {
    headers: { origin: 'https://app.example.test' },
  })

  assert.equal(response.status, 404)
  const preflight = await app.request('/owner-code/123456789', { method: 'OPTIONS' })
  assert.equal(preflight.status, 404)
})

test('maps unauthenticated attach failures to one close response while retaining owner conflict', () => {
  const runAttach = (router: RelayRouter, frame: unknown) => {
    let handlers: { onMessage(event: unknown, ws: unknown): void } | undefined
    createRelayApp(router, {
      upgradeWebSocket: ((factory: () => unknown) => {
        handlers = factory() as typeof handlers
        return (() => new Response()) as never
      }) as never,
      websocket: {} as never,
    })
    const closed: Array<{ code?: number; reason?: string }> = []
    handlers!.onMessage(
      { data: JSON.stringify(frame) },
      {
        send: () => undefined,
        close: (code: number, reason: string) => closed.push({ code, reason }),
      },
    )
    return closed
  }
  const ownerFrame = {
    type: 'relay.attach',
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    role: 'owner',
    ownerCode: '123456789',
    connectionId: 'connection-1',
    ownerPublicKey: 'public-key',
    trustEpoch: 0,
  }
  const unauthorized = runAttach(new RelayRouter({ ownerToken: 'x'.repeat(32) }), {
    ...ownerFrame,
    ownerToken: 'invalid-token',
  })
  const capacity = runAttach(new RelayRouter({ ownerToken: 'x'.repeat(32), maxConnections: 0 }), {
    ...ownerFrame,
    ownerToken: 'valid-looking-token',
  })
  const malformed = runAttach(new RelayRouter({ ownerToken: 'x'.repeat(32) }), {
    type: 'relay.attach',
    version: RELAY_PROTOCOL_VERSION,
    role: 'owner',
  })
  assert.deepEqual(unauthorized, [{ code: 1008, reason: 'attach_rejected' }])
  assert.deepEqual(capacity, unauthorized)
  assert.deepEqual(malformed, unauthorized)
})

test('logs app frame failures without logging frame contents and contains logger sinks', () => {
  const records: LogRecord[] = []
  const logger = createLogger({ sink: (record) => records.push(record) })
  let handlers: { onMessage(event: unknown, ws: unknown): void } | undefined
  createRelayApp(
    new RelayRouter({ ownerToken: 'x'.repeat(32), logger }),
    {
      upgradeWebSocket: ((factory: () => unknown) => {
        handlers = factory() as typeof handlers
        return (() => new Response()) as never
      }) as never,
      websocket: {} as never,
    },
    logger,
  )
  const closed: Array<{ code?: number; reason?: string }> = []
  handlers!.onMessage(
    { data: JSON.stringify({ payload: 'opaque-private-payload' }) },
    {
      send: () => undefined,
      close: (code: number, reason: string) => closed.push({ code, reason }),
    },
  )
  assert.deepEqual(closed, [{ code: 1008, reason: 'attach_rejected' }])
  assert.equal(JSON.stringify(records).includes('opaque-private-payload'), false)
  assert.ok(
    records.some((record) => record.fields.code === TelemetryErrorCode.relayAttachInvalidFrame),
  )
})
