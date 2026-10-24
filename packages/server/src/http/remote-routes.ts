import type { FastifyInstance } from 'fastify'

import { apiError, requireSession } from './common.js'
import type { RouteContext } from './types.js'
import type { OwnerApplicationServices } from '../owner/application-services.js'
import {
  OwnerMethodError,
  type OwnerMethodContext,
  type OwnerTransport,
} from '../owner/session-runtime.js'

export async function registerRemoteRoutes(
  app: FastifyInstance,
  { dependencies }: RouteContext,
  services?: OwnerApplicationServices,
) {
  const requireLocal = (
    request: { headers: Record<string, string | string[] | undefined> },
    reply: Parameters<typeof requireSession>[1],
  ) => {
    if (request.headers['x-codex-web-remote'] === '1') {
      void reply.status(403).send(apiError('LOCAL_ONLY', 'This operation requires the local Owner'))
      return false
    }
    return true
  }

  app.post('/api/remote/pairing/offer', async (request, reply) => {
    if (!requireLocal(request, reply)) return reply
    const session = await requireSession(request, reply, dependencies.auth)
    if (!session) return reply
    if (!dependencies.remote || !services)
      return reply
        .status(503)
        .send(apiError('REMOTE_UNAVAILABLE', 'Remote connector is unavailable'))
    try {
      const transport = localTransport(request.headers.origin)
      const controller = new AbortController()
      const context: OwnerMethodContext = {
        owner: {
          ownerId: session.user.id,
          sessionId: session.session.id,
          clientId: 'http-pairing',
          connectionId: request.id,
          transport: { kind: 'local' },
        },
        transport,
        signal: controller.signal,
        authenticate: () => undefined,
      }
      const body = isRecord(request.body) ? request.body : {}
      return await services.remotePairingOffer(context, { relayUrl: body.relayUrl })
    } catch (error) {
      if (error instanceof OwnerMethodError && error.code === 'REMOTE_RELAY_REQUIRED')
        return reply
          .status(409)
          .send(apiError('REMOTE_RELAY_REQUIRED', 'Configure CODEX_REMOTE_RELAY_URL first'))
      return reply
        .status(503)
        .send(apiError('REMOTE_UNAVAILABLE', 'Remote connector is unavailable'))
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function localTransport(origin: string | string[] | undefined): OwnerTransport {
  return {
    kind: 'local',
    origin: typeof origin === 'string' ? origin : undefined,
    send: () => undefined,
    close: () => undefined,
    onMessage: () => () => undefined,
    onClose: () => () => undefined,
  }
}
