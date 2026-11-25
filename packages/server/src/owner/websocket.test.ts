import assert from 'node:assert/strict'
import test from 'node:test'
import WebSocket from 'ws'

import type { ServerConfig } from '../config.js'
import { createHttpServer } from '../http/server-base.js'
import type { OwnerApplicationRuntime } from './runtime.js'
import { isLoopbackPeer, registerOwnerWebSocket } from './websocket.js'

function createTestRuntime(): OwnerApplicationRuntime {
  return {
    registry: new Map([
      [
        'owner.status',
        {
          access: 'public',
          handle: async () => ({ ownerExists: true, authenticated: true, ownerId: 'owner-local' }),
        },
      ],
    ]),
    resumeSession: async () => null,
    isDeviceAuthorized: async () => false,
    localManagement: {} as OwnerApplicationRuntime['localManagement'],
  }
}

test('recognizes IPv4, IPv4-mapped IPv6, and IPv6 loopback peers only', () => {
  for (const address of ['127.0.0.1', '127.14.2.3', '::1', '::ffff:127.0.0.1'])
    assert.equal(isLoopbackPeer(address), true, address)
  for (const address of [undefined, '', '::ffff:192.168.1.5', '192.168.1.5', '8.8.8.8'])
    assert.equal(isLoopbackPeer(address), false, String(address))
})

test('local websocket admits a trusted origin and serves owner.status', async () => {
  const app = await createHttpServer({
    trustedOrigins: ['http://localhost:5173'],
    enforceOriginChecks: true,
  })
  await registerOwnerWebSocket(app, {
    runtime: createTestRuntime(),
    config: {
      port: 3000,
      trustedOrigins: ['http://localhost:5173', 'https://app.remote.test'],
    } as ServerConfig,
    dependencies: {
      auth: { api: {} } as never,
      workspace: { hasOwner: async () => true, getOnlyOwnerId: async () => 'owner-local' } as never,
      codex: { events: {} } as never,
    },
  })
  await app.ready()
  const socket = await connect(app, {
    origin: 'http://localhost:5173',
    host: '127.0.0.1:3000',
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
  assert.match(ready, /"authenticated":true/)
  assert.match(ready, /"ownerId":"owner-local"/)
  socket.send(JSON.stringify({ type: 'request', requestId: 'status-1', method: 'owner.status' }))
  const response = await waitForMessage(socket, messages, (value) => value.includes('status-1'))
  assert.match(response, /"ownerExists":true/)
  socket.terminate()
  await closeWebSocketServer(app)
  await app.close()
})

test('local websocket rejects an untrusted origin before protocol admission', async () => {
  const app = await createHttpServer()
  await registerOwnerWebSocket(app, {
    runtime: createTestRuntime(),
    config: { trustedOrigins: ['http://localhost:5173'] } as ServerConfig,
    dependencies: {
      auth: { api: {} } as never,
      workspace: { hasOwner: async () => false, getOnlyOwnerId: async () => null } as never,
      codex: { events: {} } as never,
    },
  })
  await app.ready()
  const socket = await connect(app, {
    origin: 'http://attacker.example',
    host: '127.0.0.1:3000',
  })
  await waitForClose(socket)
  socket.terminate()
  await closeWebSocketServer(app)
  await app.close()
})

test('does not expand local admission to remote trusted origins or spoofed hosts', async () => {
  for (const headers of [
    { origin: 'https://app.remote.test', host: '127.0.0.1:5173' },
    {
      origin: 'http://localhost:5173',
      host: 'rebind.example:5173',
      'x-forwarded-host': 'localhost:5173',
    },
    { origin: 'null', host: 'localhost:5173' },
    { host: 'localhost:5173' },
  ]) {
    const app = await createHttpServer()
    await registerOwnerWebSocket(app, {
      runtime: createTestRuntime(),
      config: {
        port: 3000,
        trustedOrigins: [
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'https://app.remote.test',
        ],
      } as ServerConfig,
      dependencies: {
        auth: { api: {} } as never,
        workspace: { hasOwner: async () => true, getOnlyOwnerId: async () => 'owner-1' } as never,
        codex: { events: {} } as never,
      },
    })
    await app.ready()
    const socket = await connect(app, headers)
    await waitForClose(socket)
    socket.terminate()
    await closeWebSocketServer(app)
    await app.close()
  }
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

async function connect(
  app: {
    listen: (options: { host: string; port: number }) => Promise<string>
    server: import('node:http').Server
  },
  headers: Record<string, string>,
) {
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener')
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, { headers })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

async function waitForClose(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED) return
  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve())
    if (socket.readyState === WebSocket.OPEN) socket.close()
  })
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
