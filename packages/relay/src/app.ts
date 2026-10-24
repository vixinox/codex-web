import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import {
  encodeFrame,
  isRelayAttachFrame,
  parseFrame,
  RELAY_PROTOCOL_VERSION,
} from '@codex-web/protocol/relay'

import { RelayRouter, type RelaySocket } from './relay-router.js'

/**
 * Every attach failure closes with the same frame and reason. Distinguishing "unknown node",
 * "bad token" and "at capacity" would let an unauthenticated caller probe for live nodes.
 */
const ATTACH_REJECTED = 'attach_rejected'
const encoder = new TextEncoder()

export function createRelayApp(router: RelayRouter) {
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
        raw?: {
          getBufferedAmount?: () => number
          ping?: () => void
          onPong?: () => void
        }
      }): RelaySocket => ({
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
        ping: () => ws.raw?.ping?.(),
        onpong: ws.raw?.onPong ?? null,
        bufferedAmount: () => ws.raw?.getBufferedAmount?.() ?? 0,
      })

      return {
        onMessage(event, ws) {
          if (typeof event.data !== 'string') {
            ws.close(1003, 'text frames required')
            return
          }
          if (encoder.encode(event.data).byteLength > router.maxFrameBytes) {
            ws.close(1009, 'frame too large')
            return
          }
          if (!sessionId) {
            const frame = parseFrame(event.data)
            if (!isRelayAttachFrame(frame)) {
              ws.close(1008, ATTACH_REJECTED)
              return
            }
            const result = router.attach(frame, socketFor(ws))
            if (!result.ok) {
              ws.close(1008, ATTACH_REJECTED)
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
            // This socket no longer owns a slot; close only this socket and leave the node alone.
            ws.close(1008, 'session_not_found')
            return
          }
          const forwarded =
            session.role === 'owner'
              ? router.forward(sessionId, event.data)
              : router.forwardFromClient(sessionId, event.data)
          if (!forwarded) ws.close(1008, 'invalid_forward_frame')
          return
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
