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

  app.get('/ws', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin
    if (typeof origin !== 'string' || !config.trustedOrigins.includes(origin)) {
      socket.close(1008, 'ORIGIN_NOT_ALLOWED')
      return
    }

    const transport = createFastifyTransport(socket, origin)
    const runtime = new OwnerSessionRuntime(transport, registry, {
      connectionId: crypto.randomUUID(),
      capabilities: ['owner', 'credentials', 'projects', 'codex'],
      resumeSession: (token, sessionTransport) => services.resumeSession(token, sessionTransport),
    })
    runtime.start()
  })
}

function createFastifyTransport(socket: WebSocket, origin: string): OwnerTransport {
  return {
    kind: 'local',
    origin,
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
        listener(isBinary ? toBytes(data) : data.toString())
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

function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return Buffer.concat(data)
  return data
}

export function requestOrigin(request: FastifyRequest): string | undefined {
  return typeof request.headers.origin === 'string' ? request.headers.origin : undefined
}
