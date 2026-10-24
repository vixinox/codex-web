import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import {
  encodeFrame,
  isRelayAttachFrame,
  parseFrame,
  RELAY_PROTOCOL_VERSION,
} from '@codex-web/protocol/relay'

import { RelayRouter, type RelaySocket } from './relay-router.js'

export function createRelayApp(router = new RelayRouter()) {
  const app = new Hono()

  app.get('/healthz', (context) =>
    context.json({
      status: 'ok',
      protocolVersion: RELAY_PROTOCOL_VERSION,
      connections: router.connectionCount(),
    }),
  )

  app.get(
    '/ws',
    upgradeWebSocket(() => {
      let sessionId: string | undefined
      const socketFor = (ws: {
        send(data: string | ArrayBuffer | Uint8Array): void
        close(code?: number, reason?: string): void
      }): RelaySocket => ({
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
      })

      return {
        onMessage(event, ws) {
          if (typeof event.data !== 'string') {
            ws.close(1003, 'text frames required')
            return
          }
          if (!sessionId) {
            const frame = parseFrame(event.data)
            if (!isRelayAttachFrame(frame)) {
              ws.close(1002, 'relay.attach required')
              return
            }
            const result = router.attach(frame, socketFor(ws))
            if (!result.ok) {
              ws.close(1008, result.reason)
              return
            }
            sessionId = result.session.sessionId
            ws.send(
              encodeFrame({
                type: 'relay.ready',
                version: RELAY_PROTOCOL_VERSION,
                nodeId: frame.nodeId,
                role: frame.role,
                connectionId: frame.connectionId,
              }),
            )
            return
          }
          const session = router.getSession(sessionId)
          if (!session) {
            ws.close(1008, 'session_not_found')
            return
          }
          const forwarded =
            session.role === 'owner'
              ? router.forward(sessionId, event.data)
              : router.forwardFromClient(sessionId, event.data)
          if (!forwarded) ws.close(1008, 'invalid_forward_frame')
        },
        onClose() {
          if (sessionId) router.detach(sessionId)
        },
        onError() {
          if (sessionId) router.detach(sessionId)
        },
      }
    }),
  )

  return { app, router, websocket }
}
