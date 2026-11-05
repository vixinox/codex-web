import { Hono } from 'hono'
import type { UpgradeWebSocket, WSEvents } from 'hono/ws'
import type { BunWebSocketHandler, BunWebSocketData } from 'hono/bun'
import {
  encodeFrame,
  isRelayAttachFrame,
  isRelayEnrollmentRegisterFrame,
  isRelayEnrollmentUnregisterFrame,
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

function relayLog(message: string) {
  console.error(`${new Date().toISOString()} [RELAY] ${message}`)
}

export function createRelayApp(
  router: RelayRouter,
  webSocketAdapter: {
    upgradeWebSocket: UpgradeWebSocket<BunWebSocketData>
    websocket: BunWebSocketHandler<BunWebSocketData>
  },
) {
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
          relayLog('Rejected client frame before attach')
          ws.close(1008, ATTACH_REJECTED)
          return
        }
        const result = router.attach(frame, socketFor(ws))
        if (!result.ok) {
          relayLog(
            `Attach rejected (${frame.role}:${frame.role === 'client' ? (frame.admission ?? 'paired') : 'owner'}; ${result.reason})`,
          )
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
            trustEpoch: result.session.trustEpoch,
            ownerPublicKey: result.session.ownerPublicKey,
          }),
        )
        return
      }
      const control = parseFrame(event.data)
      if (isRelayEnrollmentRegisterFrame(control)) {
        if (!router.registerEnrollmentReference(sessionId, control)) {
          relayLog('Enrollment reference registration rejected')
          ws.close(1008, 'invalid_enrollment_reference')
        } else relayLog('Enrollment reference registered')
        return
      }
      if (isRelayEnrollmentUnregisterFrame(control)) {
        if (!router.unregisterEnrollmentReference(sessionId, control.reference)) {
          relayLog('Enrollment reference unregister rejected')
          ws.close(1008, 'invalid_enrollment_reference')
        } else relayLog('Enrollment reference unregistered')
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
      relayLog('Relay WebSocket error')
      if (sessionId) router.detach(sessionId)
    },
  }
}
