import { createRelayApp } from './app.js'

const port = Number(process.env.RELAY_PORT ?? 8787)
const hostname = process.env.RELAY_HOST ?? '127.0.0.1'
const { app, websocket } = createRelayApp()

Bun.serve({
  fetch: app.fetch,
  websocket,
  hostname,
  port: Number.isSafeInteger(port) && port > 0 ? port : 8787,
})

console.log(`Relay listening at ws://${hostname}:${port}`)
