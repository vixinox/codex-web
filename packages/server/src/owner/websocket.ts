import websocket from '@fastify/websocket'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from '@fastify/websocket'

import type { ServerConfig } from '../config.js'
import { createOwnerApplicationServices } from './application-services.js'
import type { OwnerApplicationServices } from './application-services.js'
import { createOwnerMethodRegistry } from './methods.js'
import type { AppDependencies } from '../http/types.js'
import { OwnerSessionRuntime, type OwnerTransport } from './session-runtime.js'

type OwnerWebSocketOptions = {
  config: ServerConfig
  dependencies: AppDependencies
  services?: OwnerApplicationServices
}

export async function registerOwnerWebSocket(
  app: FastifyInstance,
  { config, dependencies, services: providedServices }: OwnerWebSocketOptions,
) {
  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    },
  })

  const services =
    providedServices ??
    createOwnerApplicationServices(dependencies, {
      trustedOrigins: config.trustedOrigins,
      requireDangerousAccessConfirmation: config.requireDangerousAccessConfirmation,
      remoteRelayUrl: config.remoteRelayUrl,
    })
  const registry = createOwnerMethodRegistry(services)
  dependencies.remote?.configureRemoteSessions(registry, (token, transport) =>
    services.resumeSession(token, transport),
  )

  app.get('/ws', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin
    if (typeof origin !== 'string' || !config.trustedOrigins.includes(origin)) {
      socket.close(1008, 'ORIGIN_NOT_ALLOWED')
      return
    }

    const transport = createFastifyTransport(socket, origin, request.query)
    const runtime = new OwnerSessionRuntime(transport, registry, {
      connectionId: crypto.randomUUID(),
      capabilities: ['owner', 'credentials', 'projects', 'codex'],
      resumeSession: (token, sessionTransport) => services.resumeSession(token, sessionTransport),
    })
    runtime.start()
  })
}

function createFastifyTransport(socket: WebSocket, origin: string, query: unknown): OwnerTransport {
  const enrollmentTicket = readEnrollmentTicket(query)
  return {
    kind: 'local',
    origin,
    ...(enrollmentTicket ? { enrollmentTicket } : {}),
    send(frame) {
      if (socket.readyState !== socket.OPEN) return
      socket.send(frame, { binary: frame instanceof Uint8Array })
    },
    close(code, reason) {
      if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)
        socket.close(code, reason)
    },
    onMessage(listener) {
      const onMessage = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        const bytes = toBytes(data)
        listener(isBinary ? bytes : new TextDecoder().decode(bytes))
      }
      socket.on('message', onMessage)
      return () => socket.off('message', onMessage)
    },
    onClose(listener) {
      const onClose = (_code: number, reason: Buffer) => listener(reason.toString())
      socket.on('close', onClose)
      return () => socket.off('close', onClose)
    },
  }
}

function readEnrollmentTicket(query: unknown) {
  if (!query || typeof query !== 'object' || !('ticket' in query)) return undefined
  const ticket = (query as { ticket?: unknown }).ticket
  return typeof ticket === 'string' && /^[A-Za-z0-9_-]{32,128}$/u.test(ticket) ? ticket : undefined
}

function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return Buffer.concat(data)
  return data
}

export function requestOrigin(request: FastifyRequest): string | undefined {
  return typeof request.headers.origin === 'string' ? request.headers.origin : undefined
}
