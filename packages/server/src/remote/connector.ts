import { randomUUID } from 'node:crypto'

import { encodeFrame, parseFrame, RELAY_PROTOCOL_VERSION } from '@codex-web/protocol/relay'
import WebSocket from 'ws'

import type { ServerConfig } from '../config.js'
import { log } from '../logger.js'
import { OwnerSessionRuntime, type OwnerMethodRegistry } from '../owner/session-runtime.js'
import { RemoteTrustStore } from './trust-store.js'
import { signAdmissionToken } from './admission-token.js'
import { RemoteClientSessions } from './sessions/index.js'

export type ConnectorTransport = {
  send(data: string): void
  close?: (code?: number, reason?: string) => void
}

type RelayWebSocketHandlers = {
  onopen?: ((...args: never[]) => void) | null
  onmessage?: ((...args: never[]) => void) | null
  onclose?: ((...args: never[]) => void) | null
  onerror?: ((...args: never[]) => void) | null
}

type RelayWebSocket = ConnectorTransport &
  RelayWebSocketHandlers & {
    ping?: () => void
    onpong?: (() => void) | null
    on?: (event: 'pong', listener: () => void) => unknown
  }

type RelayWebSocketFactory = (url: string) => RelayWebSocket

const RELAY_READY_TIMEOUT_MS = 10_000
const RELAY_HEARTBEAT_INTERVAL_MS = 10_000
const RELAY_STALE_TIMEOUT_MS = 30_000

const defaultWebSocketFactory: RelayWebSocketFactory = (url) => {
  return new WebSocket(url) as unknown as RelayWebSocket
}

export class OwnerConnector {
  private transport?: ConnectorTransport
  private socket?: RelayWebSocket
  private connected = false
  private lastRelayCloseReason?: string
  private running = false
  private lastRelayActivity = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private relayReadyTimer?: ReturnType<typeof setTimeout>
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private reconnectAttempt = 0
  private readonly connectionId = randomUUID()
  private enrollmentReference?: { reference: string; expiresAt: number }
  private inboundRelayMessages: Promise<void> = Promise.resolve()
  private readonly clients: RemoteClientSessions

  private readonly config: ServerConfig
  readonly trust: RemoteTrustStore
  private readonly webSocketFactory: RelayWebSocketFactory
  private readonly heartbeatIntervalMs: number
  private readonly staleTimeoutMs: number

  constructor(
    config: ServerConfig,
    trust: RemoteTrustStore,
    webSocketFactory: RelayWebSocketFactory = defaultWebSocketFactory,
    heartbeat: { intervalMs?: number; staleTimeoutMs?: number } = {},
  ) {
    this.config = config
    this.trust = trust
    this.clients = new RemoteClientSessions(trust, (frame) => this.sendRelayFrame(frame))
    this.webSocketFactory = webSocketFactory
    this.heartbeatIntervalMs = heartbeat.intervalMs ?? RELAY_HEARTBEAT_INTERVAL_MS
    this.staleTimeoutMs = heartbeat.staleTimeoutMs ?? RELAY_STALE_TIMEOUT_MS
  }

  async start() {
    await this.trust.load()
    this.running = true
    if (this.config.remoteRelayUrl) this.connect()
  }

  async stop() {
    this.running = false
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.clearRelayTimers()
    await this.clients.closeAllConnections('owner_shutdown')
    this.enrollmentReference = undefined
    this.detachTransport()
    this.socket?.close?.(1000, 'owner_shutdown')
    this.socket = undefined
  }

  attachTransport(transport: ConnectorTransport) {
    this.transport = transport
    this.connected = false
  }

  detachTransport() {
    this.transport = undefined
    this.connected = false
  }

  isConnected() {
    return this.connected
  }

  async waitUntilConnected(timeoutMs = RELAY_READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs
    while (!this.connected && Date.now() < deadline) {
      if (this.lastRelayCloseReason === 'owner_code_conflict')
        throw new Error('OWNER_CODE_CONFLICT')
      if (!this.running) throw new Error('REMOTE_UNAVAILABLE')
      // Polling depends on each prior state check.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const poll = () => {
          if (
            this.connected ||
            this.lastRelayCloseReason === 'owner_code_conflict' ||
            !this.running
          ) {
            resolve(undefined)
          } else if (Date.now() >= deadline) {
            resolve(undefined)
          } else {
            setTimeout(poll, 50)
          }
        }
        setTimeout(poll, 50)
      })
    }
    if (!this.connected) throw new Error('REMOTE_UNAVAILABLE')
  }

  async createPairedClientToken(deviceId: string) {
    const identity = await this.trust.identity()
    return signRelayToken(this.requireRelaySecret(), {
      nodeId: identity.nodeId,
      trustEpoch: identity.trustEpoch,
      role: 'client',
      deviceId,
      purpose: 'paired-attach',
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
  }

  async registerEnrollmentReference(reference: string, expiresAt: number) {
    this.enrollmentReference = { reference, expiresAt }
    if (this.connected)
      this.sendRelayFrame({
        type: 'relay.enrollment.register',
        version: RELAY_PROTOCOL_VERSION,
        reference,
        expiresAt,
      })
  }

  hasEnrollmentReference(reference: string) {
    return this.enrollmentReference?.reference === reference
  }

  async unregisterEnrollmentReference(reference?: string) {
    if (reference && this.enrollmentReference?.reference !== reference) return
    const active = this.enrollmentReference
    this.enrollmentReference = undefined
    if (this.connected && active)
      this.sendRelayFrame({
        type: 'relay.enrollment.unregister',
        version: RELAY_PROTOCOL_VERSION,
        reference: active.reference,
      })
  }

  configureRemoteSessions(
    registry: OwnerMethodRegistry,
    resumeSession: NonNullable<
      ConstructorParameters<typeof OwnerSessionRuntime>[2]['resumeSession']
    >,
    authorizeDevice?: (deviceId: string) => Promise<boolean>,
  ) {
    this.clients.configureRemoteSessions(registry, resumeSession, authorizeDevice)
  }

  async listDevices() {
    return this.trust.listPeers()
  }

  async revokeDevice(deviceId: string, reason = 'device_revoked') {
    this.clients.invalidateHandshakes()
    const publicKey = await this.trust.revokePeer(deviceId)
    await this.disconnectDevice(deviceId, reason, publicKey ?? undefined)
    return Boolean(publicKey)
  }

  async revokeAllDevices(reason = 'device_revoked') {
    this.clients.invalidateHandshakes()
    await this.trust.clearPeers()
    await this.disconnectDevice(undefined, reason)
  }

  async disconnectDevice(deviceId?: string, reason = 'access_unavailable', publicKey?: string) {
    return this.clients.disconnectDevice(deviceId, reason, publicKey)
  }

  sendFrame(frame: string) {
    this.transport?.send(frame)
  }

  private requireRelaySecret() {
    const secret = this.config.remoteRelayOwnerToken
    if (!secret) throw new Error('CODEX_REMOTE_RELAY_ADMISSION_REQUIRED')
    return secret
  }

  private connect() {
    if (!this.running || !this.config.remoteRelayUrl || this.socket) return
    let socket: RelayWebSocket
    try {
      socket = this.webSocketFactory(this.config.remoteRelayUrl)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      if (this.socket !== socket) return
      this.attachTransport(socket)
      this.lastRelayCloseReason = undefined
      this.lastRelayActivity = Date.now()
      this.relayReadyTimer = setTimeout(() => {
        if (this.socket !== socket) return
        socket.close?.(4000, 'relay_ready_timeout')
      }, RELAY_READY_TIMEOUT_MS)
      void this.sendRelayAttach()
    }
    // The browser WebSocket hands handlers a MessageEvent; Node-style clients hand the payload.
    // Accept either so the same connector works under Bun, browsers and ws.
    socket.onmessage = (event: unknown) => {
      if (this.socket !== socket) return
      const data =
        typeof event === 'object' && event !== null && 'data' in event ? event.data : event
      if (typeof data !== 'string') return
      this.lastRelayActivity = Date.now()
      this.inboundRelayMessages = this.inboundRelayMessages
        .then(() => {
          if (this.socket !== socket) return undefined
          return this.handleRelayMessage(data)
        })
        .catch(() => undefined)
    }
    socket.onerror = () => {
      if (this.socket !== socket) return
      log.warn('owner.remote.socket-error')
      this.detachTransport()
    }
    socket.onclose = (...args: never[]) => {
      const [eventOrCode, closeReason] = args as unknown[]
      const event =
        typeof eventOrCode === 'object' && eventOrCode !== null
          ? (eventOrCode as { reason?: unknown })
          : undefined
      const reason =
        typeof event?.reason === 'string'
          ? event.reason
          : typeof closeReason === 'string'
            ? closeReason
            : Buffer.isBuffer(closeReason)
              ? closeReason.toString()
              : undefined
      this.lastRelayCloseReason = reason
      if (this.socket === socket) this.socket = undefined
      this.clearRelayTimers()
      this.detachTransport()
      this.enrollmentReference = undefined
      this.clients.teardownAllConnections('relay_disconnected', false)
      this.scheduleReconnect()
    }
  }

  private async sendRelayAttach() {
    const { nodeId, ownerCode, trustEpoch, ownerPublicKey } = await this.trust.identity()
    if (!this.socket) return
    this.sendRelayFrame({
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId,
      ownerCode,
      role: 'owner',
      connectionId: this.connectionId,
      ownerToken: signRelayToken(this.requireRelaySecret(), {
        nodeId,
        trustEpoch,
        role: 'owner',
        expiresAt: Date.now() + 5 * 60 * 1000,
      }),
      ownerPublicKey,
      trustEpoch,
    })
  }

  private startHeartbeat(socket: RelayWebSocket) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    const handlePong = () => {
      if (this.socket === socket) this.lastRelayActivity = Date.now()
    }
    if (socket.on) socket.on('pong', handlePong)
    else socket.onpong = handlePong
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket) return
      // A relay that stopped answering while the socket stays half-open never emits `close`.
      // Treat silence past the stale window as a dead link and force a reconnect.
      if (Date.now() - this.lastRelayActivity > this.staleTimeoutMs) {
        socket.close?.(4001, 'relay_stale')
        return
      }
      // Use a WebSocket control frame so application traffic does not masquerade as liveness.
      socket.ping?.()
    }, this.heartbeatIntervalMs)
  }

  private clearRelayTimers() {
    if (this.relayReadyTimer) clearTimeout(this.relayReadyTimer)
    this.relayReadyTimer = undefined
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  private scheduleReconnect() {
    if (!this.running || !this.config.remoteRelayUrl || this.reconnectTimer) return
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempt++, 6))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delay)
  }

  private async handleRelayMessage(data: string) {
    const frame = parseFrame(data)
    if (!frame) return
    if (frame.type === 'relay.forward') {
      await this.clients.handleForward(frame)
      return
    }
    if (frame.type === 'relay.ready') {
      const identity = await this.trust.identity()
      if (
        frame.nodeId === identity.nodeId &&
        frame.role === 'owner' &&
        frame.connectionId === this.connectionId
      ) {
        clearTimeout(this.relayReadyTimer)
        this.relayReadyTimer = undefined
        this.connected = true
        this.reconnectAttempt = 0
        if (this.socket) this.startHeartbeat(this.socket)
      } else {
        this.socket?.close?.(1008, 'invalid_relay_ready')
      }
      return
    }
    if (frame.type === 'relay.client.connected') {
      const deviceId = 'deviceId' in frame ? frame.deviceId : undefined
      const enrollmentCandidate = frame.admission === 'enrollment'
      if (!deviceId && !enrollmentCandidate) {
        // Relay admission always carries the device binding; without it the Owner cannot tell
        // which paired device owns this connection.
        this.socket?.close?.(1008, 'invalid_client_binding')
        return
      }
      const candidateId = deviceId ?? (enrollmentCandidate ? frame.admission : undefined)
      if (!candidateId) {
        this.socket?.close?.(1008, 'invalid_client_binding')
        return
      }
      this.clients.attach(
        frame.connectionId,
        candidateId,
        enrollmentCandidate && typeof frame.reference === 'string' ? frame.reference : undefined,
      )
      return
    }
    if (frame.type === 'relay.client.disconnected') {
      this.clients.detach(frame.connectionId)
    }
  }

  private sendRelayFrame(frame: Parameters<typeof encodeFrame>[0]) {
    this.transport?.send(encodeFrame(frame))
  }
}

export function createRelayForwardFrame(connectionId: string, payload: string) {
  return encodeFrame({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId,
    payload,
  })
}

function signRelayToken(secret: string, claims: Record<string, string | number>) {
  return signAdmissionToken(secret, { ...claims, purpose: 'paired-attach' } as never)
}
