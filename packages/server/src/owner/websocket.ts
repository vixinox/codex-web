import websocket from '@fastify/websocket'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { isIP } from 'node:net'

import type { ServerConfig } from '../config.js'
import { createOwnerApplicationServices } from './application-services.js'
import type { OwnerApplicationServices } from './application-services.js'
import { createOwnerMethodRegistry } from './methods.js'
import type { AppDependencies } from '../http/types.js'
import { OwnerSessionRuntime, type OwnerTransport } from './session-runtime.js'
import type { OwnerAdmission } from './session-runtime.js'

const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const

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
      remoteRelayUrl: config.remoteRelayUrl,
    })
  const registry = createOwnerMethodRegistry(services)
  dependencies.remote?.configureRemoteSessions(
    registry,
    (token, transport) => services.resumeSession(token, transport),
    services.isDeviceAuthorized,
  )

  app.get('/ws', { websocket: true }, (socket, request) => {
    const origin = request.headers.origin
    const peerAddress = request.raw.socket?.remoteAddress
    if (
      !isLoopbackPeer(peerAddress) ||
      !isLocalOrigin(origin) ||
      !isLocalHost(request.headers.host, config.port)
    ) {
      socket.close(1008, 'LOCAL_ACCESS_NOT_ALLOWED')
      return
    }

    const connectionId = crypto.randomUUID()
    const transport = createFastifyTransport(socket, origin)
    void dependencies.workspace
      .getOnlyOwnerId()
      .then((ownerId) => {
        if (socket.readyState !== socket.OPEN) return undefined
        if (!ownerId) {
          socket.close(1008, 'OWNER_NOT_INITIALIZED')
          return undefined
        }
        const localAdmission: OwnerAdmission = { ownerId, sessionId: `local:${connectionId}` }
        const runtime = new OwnerSessionRuntime(transport, registry, {
          connectionId,
          capabilities: ['owner', 'credentials', 'projects', 'codex'],
          localAdmission,
        })
        runtime.start()
        return undefined
      })
      .catch(() => socket.close(1011, 'OWNER_UNAVAILABLE'))
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

export function isLoopbackPeer(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.toLowerCase().replace(/^::ffff:/u, '')
  if (normalized === '::1') return true
  return isIP(normalized) === 4 && normalized.startsWith('127.')
}

function isLocalOrigin(origin: string | undefined): origin is (typeof LOCAL_ORIGINS)[number] {
  return LOCAL_ORIGINS.some((allowed) => allowed === origin)
}

function isLocalHost(host: string | undefined, ownerPort: number): boolean {
  if (!host || /[,\s/@\\]/u.test(host)) return false
  let parsed: URL
  try {
    parsed = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash)
    return false
  const hostname = parsed.hostname.toLowerCase()
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false
  const authority = parsed.host.toLowerCase()
  const allowedPorts = new Set([String(ownerPort), '5173'])
  return [...allowedPorts].some((port) => authority === `${hostname}:${port}`)
}

function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return Buffer.concat(data)
  return data
}

export function requestOrigin(request: FastifyRequest): string | undefined {
  return typeof request.headers.origin === 'string' ? request.headers.origin : undefined
}
