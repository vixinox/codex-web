import assert from 'node:assert/strict'
import test from 'node:test'

import type { ServerConfig } from '../config.js'
import { createHttpServer } from '../http/server-base.js'
import { registerOwnerWebSocket } from './websocket.js'

test('local websocket admits a trusted origin and serves owner.status', async () => {
  const app = await createHttpServer({
    trustedOrigins: ['http://localhost:5173'],
    enforceOriginChecks: true,
  })
  await registerOwnerWebSocket(app, {
    config: {
      trustedOrigins: ['http://localhost:5173'],
    } as ServerConfig,
    dependencies: {
      auth: { api: {} } as never,
      workspace: { hasOwner: async () => false } as never,
      codex: { events: {} } as never,
    },
  })
  await app.ready()

  const socket = await app.injectWS('/ws', {
    headers: { origin: 'http://localhost:5173' },
  })
  const messages: string[] = []
  socket.on('message', (message) => messages.push(message.toString()))
  socket.send(
    JSON.stringify({
      type: 'hello',

      clientId: 'client-1',
      capabilities: ['owner'],
    }),
  )
  const ready = await waitForMessage(socket, messages, (value) => value.includes('"ready"'))
  assert.match(ready, /"authenticated":false/)
  socket.send(JSON.stringify({ type: 'request', requestId: 'status-1', method: 'owner.status' }))
  const response = await waitForMessage(socket, messages, (value) => value.includes('status-1'))
  assert.match(response, /"ownerExists":false/)
  socket.terminate()
  await closeWebSocketServer(app)
  await app.close()
})

test('local websocket rejects an untrusted origin before protocol admission', async () => {
  const app = await createHttpServer()
  await registerOwnerWebSocket(app, {
    config: { trustedOrigins: ['http://localhost:5173'] } as ServerConfig,
    dependencies: {
      auth: { api: {} } as never,
      workspace: { hasOwner: async () => false } as never,
      codex: { events: {} } as never,
    },
  })
  await app.ready()
  const socket = await app.injectWS('/ws', {
    headers: { origin: 'http://attacker.example' },
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(socket.readyState === socket.OPEN, false)
  socket.terminate()
  await closeWebSocketServer(app)
  await app.close()
})

async function closeWebSocketServer(app: {
  websocketServer?: {
    clients: Set<{ terminate: () => void }>
    close: (callback: () => void) => void
  }
}) {
  if (!app.websocketServer) return
  for (const client of app.websocketServer.clients) client.terminate()
  await new Promise<void>((resolve) => app.websocketServer!.close(resolve))
}

async function waitForMessage(
  socket: { once: (event: 'message', listener: (message: Buffer) => void) => unknown },
  messages: string[],
  predicate: (message: string) => boolean,
): Promise<string> {
  const existing = messages.find(predicate)
  if (existing) return existing
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for websocket message.')),
      1000,
    )
    socket.once('message', (message) => {
      const value = message.toString()
      if (predicate(value)) {
        clearTimeout(timer)
        resolve(value)
      } else {
        void waitForMessage(socket, messages, predicate).then(resolve, reject)
      }
    })
  })
}
