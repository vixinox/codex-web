import { Hono } from 'hono'
import type { UpgradeWebSocket, WSEvents } from 'hono/ws'
import type { BunWebSocketHandler, BunWebSocketData } from 'hono/bun'
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

export function createRelayApp(
  router: RelayRouter,
  webSocketAdapter: {
    upgradeWebSocket: UpgradeWebSocket<BunWebSocketData>
    websocket: BunWebSocketHandler<BunWebSocketData>
  },
) {
  const app = new Hono()
  app.use('/owner-code/*', async (context, next) => {
    await next()
    context.header('access-control-allow-origin', '*')
    context.header('access-control-allow-methods', 'GET, OPTIONS')
    context.header('access-control-allow-headers', 'accept')
    context.header('cache-control', 'no-store')
  })

  app.options('/owner-code/:ownerCode', (context) => {
    context.header('access-control-allow-origin', '*')
    context.header('access-control-allow-methods', 'GET, OPTIONS')
    context.header('access-control-allow-headers', 'accept')
    context.header('cache-control', 'no-store')
    return context.body(null, 204)
  })

  app.get('/healthz', (context) =>
    context.json({
      status: 'ok',
      protocolVersion: RELAY_PROTOCOL_VERSION,
      connections: router.connectionCount(),
    }),
  )

  app.get('/owner-code/:ownerCode', (context) => {
    const { ownerCode } = context.req.param()
    if (!/^[0-9]{9}$/.test(ownerCode)) return context.json({ error: 'invalid_owner_code' }, 400)
    return context.json(router.resolveOwnerCode(ownerCode))
  })

  app.get(
    '/ws',
    webSocketAdapter.upgradeWebSocket(() => createWebSocketHandlers(router)),
  )

  return { app, router, websocket: webSocketAdapter.websocket }
}

function createWebSocketHandlers(router: RelayRouter): WSEvents<BunWebSocketData> {
  let sessionId: string | undefined
  const socketFor = (ws: import('hono/ws').WSContext): RelaySocket => {
    const raw = ws.raw as unknown as
      | {
          ping?: () => void
          getBufferedAmount?: () => number
          onPong?: () => void
        }
      | undefined
    return {
      send: (data) =>
        ws.send(
          typeof data === 'string' || data instanceof ArrayBuffer ? data : new Uint8Array(data),
        ),
      close: (code, reason) => ws.close(code, reason),
      ping: () => raw?.ping?.(),
      onpong: raw?.onPong ?? null,
      bufferedAmount: () => raw?.getBufferedAmount?.() ?? 0,
    }
  }
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
          ws.close(
            1008,
            frame.role === 'owner' && result.reason === 'owner_code_conflict'
              ? 'owner_code_conflict'
              : ATTACH_REJECTED,
          )
          return
        }
        sessionId = result.session.sessionId
        ws.send(
          encodeFrame({
            type: 'relay.ready',
            version: RELAY_PROTOCOL_VERSION,
            nodeId: result.session.nodeId,
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
}
