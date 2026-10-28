import { createRelayApp } from './app.js'
import { RelayRouter } from './relay-router.js'
import { upgradeWebSocket, websocket } from 'hono/bun'

const port = Number(process.env.RELAY_PORT ?? 8787)
const hostname = process.env.RELAY_HOST ?? '127.0.0.1'
const ownerToken = process.env.RELAY_OWNER_TOKEN?.trim()
if (!ownerToken || ownerToken.length < 32)
  throw new Error('RELAY_OWNER_TOKEN must be at least 32 characters')
const positiveInt = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}
const { app } = createRelayApp(
  new RelayRouter({
    ownerToken,
    maxConnections: positiveInt('RELAY_MAX_CONNECTIONS', 10_000),
    maxClientsPerNode: positiveInt('RELAY_MAX_CLIENTS_PER_NODE', 8),
    maxFrameBytes: positiveInt('RELAY_MAX_FRAME_BYTES', 2 * 1024 * 1024),
    messagesPerSecond: positiveInt('RELAY_MESSAGES_PER_SECOND', 250),
    maxQueuedBytes: positiveInt('RELAY_MAX_QUEUED_BYTES', 8 * 1024 * 1024),
  }),
  { upgradeWebSocket, websocket },
)

Bun.serve({
  fetch: app.fetch,
  websocket,
  hostname,
  port: Number.isSafeInteger(port) && port > 0 ? port : 8787,
})

console.log(`Relay listening at ws://${hostname}:${port}`)
