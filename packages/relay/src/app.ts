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
  type ConnectionRole,
} from '@codex-web/protocol/relay'
import { TelemetryErrorCode } from '@codex-web/telemetry/errors'
import type { Logger } from '@codex-web/telemetry/logger'

import {
  mapRelaySocketClose,
  type RelayCloseContext,
  type RelayFailureCode,
} from './close-policy.js'
import { containRelayLogger, nullRelayLogger } from './logging.js'
import { RelayRouter, type RelaySocket } from './relay-router.js'

/**
 * Unauthenticated attach failures share one close frame and reason. Owner code conflict retains
 * its existing dedicated routing response as an intentional exception.
 */
const encoder = new TextEncoder()

export function createRelayApp(
  router: RelayRouter,
  webSocketAdapter: {
    upgradeWebSocket: UpgradeWebSocket<BunWebSocketData>
    websocket: BunWebSocketHandler<BunWebSocketData>
  },
  logger: Logger = nullRelayLogger,
) {
  const appLogger = containRelayLogger(logger).child({ service: 'relay', component: 'app' })
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
    webSocketAdapter.upgradeWebSocket(() => createWebSocketHandlers(router, appLogger)),
  )

  return { app, router, websocket: webSocketAdapter.websocket }
}

function createWebSocketHandlers(router: RelayRouter, logger: Logger): WSEvents<BunWebSocketData> {
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
        const close = mapRelaySocketClose(TelemetryErrorCode.relayFrameInvalid, 'text-frame')
        logger.warn('relay.frame.rejected', { code: TelemetryErrorCode.relayFrameInvalid })
        ws.close(close.code, close.reason)
        return
      }
      if (encoder.encode(event.data).byteLength > router.maxFrameBytes) {
        const code = TelemetryErrorCode.relayFrameTooLarge
        logger.warn('relay.frame.rejected', { code })
        const close = mapRelaySocketClose(code, 'frame')
        ws.close(close.code, close.reason)
        return
      }
      if (!sessionId) {
        const frame = parseFrame(event.data)
        if (!isRelayAttachFrame(frame)) {
          const code = TelemetryErrorCode.relayAttachInvalidFrame
          const role = frameRole(frame)
          logger.warn('relay.attach.rejected', { code, ...(role ? { role } : {}) })
          closeFor(ws, code, 'attach')
          return
        }
        const result = router.attach(frame, socketFor(ws))
        if (!result.ok) {
          closeFor(ws, result.code, 'attach')
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
        const result = router.registerEnrollmentReference(sessionId, control)
        if (!result.ok) closeFor(ws, result.code, 'enrollment')
        return
      }
      if (isRelayEnrollmentUnregisterFrame(control)) {
        const result = router.unregisterEnrollmentReference(sessionId, control.reference)
        if (!result.ok) closeFor(ws, result.code, 'enrollment')
        return
      }
      const session = router.getSession(sessionId)
      if (!session) {
        // This socket no longer owns a slot; close only this socket and leave the node alone.
        closeFor(ws, TelemetryErrorCode.relayConnectionPeerDisconnected, 'session-missing')
        return
      }
      const forwarded =
        session.role === 'owner'
          ? router.forward(sessionId, event.data)
          : router.forwardFromClient(sessionId, event.data)
      if (!forwarded.ok) closeFor(ws, forwarded.code, 'frame')
      return
    },
    onClose() {
      if (sessionId) router.detach(sessionId)
    },
    onError() {
      logger.warn('relay.connection.socket-error', {
        ...(sessionId ? { connectionId: sessionId } : {}),
      })
      if (sessionId) router.detach(sessionId)
    },
  }

  function closeFor(
    ws: import('hono/ws').WSContext,
    code: RelayFailureCode,
    context: RelayCloseContext,
  ) {
    const close = mapRelaySocketClose(code, context)
    ws.close(close.code, close.reason)
  }
}

function frameRole(frame: unknown): ConnectionRole | undefined {
  if (typeof frame !== 'object' || frame === null || !('role' in frame)) return undefined
  const role = (frame as { role?: unknown }).role
  return role === 'owner' || role === 'client' ? role : undefined
}
