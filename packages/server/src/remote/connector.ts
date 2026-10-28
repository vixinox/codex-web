import { randomUUID } from 'node:crypto'

import {
  decryptPayload,
  deriveSessionKey,
  encryptPayload,
  importPrivateKey,
  importPublicKey,
  type SessionKey,
} from '@codex-web/protocol/relay/crypto'
import {
  encodeFrame,
  isEncryptedFrame,
  isHandshakeFrame,
  parseFrame,
  RELAY_PROTOCOL_VERSION,
  type ConnectionCloseFrame,
  type EncryptedFrame,
  type RelayForwardFrame,
} from '@codex-web/protocol/relay'

import type { ServerConfig } from '../config.js'
import {
  OwnerSessionRuntime,
  VirtualOwnerTransport,
  type OwnerMethodRegistry,
} from '../owner/session-runtime.js'
import { RemoteTrustStore } from './trust-store.js'
import { LoginQrCapabilityStore } from './login-qr-capability-store.js'
import { signAdmissionToken } from './admission-token.js'

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
  }

type RelayWebSocketFactory = (url: string) => RelayWebSocket

type ClientSession = {
  key: SessionKey
  lastReceiveSequence: number
  sendSequence: number
  publicKey: string
  deviceId: string
  transport: VirtualOwnerTransport
  runtime: OwnerSessionRuntime
  createdAt: number
}

/** Per-relay-connection handshake state. A connection holds exactly one of these for its lifetime. */
type ConnectionState =
  | { phase: 'awaiting_handshake' }
  | { phase: 'handshaking' }
  | { phase: 'open'; session: ClientSession }

const RELAY_READY_TIMEOUT_MS = 10_000
const RELAY_HEARTBEAT_INTERVAL_MS = 10_000
const RELAY_STALE_TIMEOUT_MS = 30_000

const defaultWebSocketFactory: RelayWebSocketFactory = (url) => {
  const WebSocketConstructor = (
    globalThis as unknown as {
      WebSocket?: new (url: string) => WebSocket
    }
  ).WebSocket
  if (!WebSocketConstructor) throw new Error('WEBSOCKET_UNAVAILABLE')
  return new WebSocketConstructor(url)
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
  private readonly connections = new Map<string, ConnectionState>()
  private readonly connectedClientIds = new Map<string, string>()
  private runtimeRegistry?: OwnerMethodRegistry
  private resumeSession?: NonNullable<
    ConstructorParameters<typeof OwnerSessionRuntime>[2]['resumeSession']
  >
  private inboundRelayMessages: Promise<void> = Promise.resolve()

  private readonly config: ServerConfig
  readonly trust: RemoteTrustStore
  readonly loginQrCapabilities = new LoginQrCapabilityStore()
  private readonly webSocketFactory: RelayWebSocketFactory

  constructor(
    config: ServerConfig,
    trust: RemoteTrustStore,
    webSocketFactory: RelayWebSocketFactory = defaultWebSocketFactory,
  ) {
    this.config = config
    this.trust = trust
    this.webSocketFactory = webSocketFactory
  }

  async start() {
    await this.trust.load()
    this.running = true
    if (this.config.remoteRelayUrl) this.connect()
  }

  async stop() {
    this.running = false
    this.loginQrCapabilities.invalidate()
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.clearRelayTimers()
    await this.closeAllConnections('owner_shutdown')
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

  async rotateOwnerCode() {
    const previous = await this.trust.ownerCode()
    const ownerCode = await this.trust.rotateOwnerCode()
    if (!this.config.remoteRelayUrl) return ownerCode
    await this.refreshOwnerCode()
    try {
      await this.waitUntilConnected()
      return ownerCode
    } catch (error) {
      await this.trust.setOwnerCode(previous)
      await this.refreshOwnerCode()
      await this.waitUntilConnected().catch(() => undefined)
      throw error
    }
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

  async resetRemoteTrust() {
    await this.closeAllConnections('trust_reset')
    const reset = await this.trust.reset()
    this.loginQrCapabilities.invalidate()
    this.socket?.close?.(1012, 'trust_reset')
    return reset
  }

  async issueLoginQrCapability(ownerId: string) {
    const identity = await this.trust.identity()
    return this.loginQrCapabilities.issue(ownerId, identity.nodeId, identity.trustEpoch)
  }

  async cancelLoginQrCapability() {
    return this.loginQrCapabilities.cancel()
  }

  loginQrCapabilityStatus() {
    return this.loginQrCapabilities.status()
  }

  async consumeLoginQrCapability(capability: string) {
    const identity = await this.trust.identity()
    return this.loginQrCapabilities.consume(capability, identity.nodeId, identity.trustEpoch)
  }

  async refreshOwnerCode() {
    await this.closeAllConnections('owner_code_rotated')
    this.socket?.close?.(1012, 'owner_code_rotated')
  }

  configureRemoteSessions(
    registry: OwnerMethodRegistry,
    resumeSession: NonNullable<
      ConstructorParameters<typeof OwnerSessionRuntime>[2]['resumeSession']
    >,
  ) {
    this.runtimeRegistry = registry
    this.resumeSession = resumeSession
  }

  async listDevices() {
    return this.trust.listPeers()
  }

  async revokeDevice(deviceId: string) {
    const publicKey = await this.trust.revokePeer(deviceId)
    if (!publicKey) return false
    const revoked: string[] = []
    for (const [connectionId, state] of this.connections) {
      if (state.phase !== 'open' || state.session.publicKey !== publicKey) continue
      revoked.push(connectionId)
    }
    await Promise.all(
      revoked.map((connectionId) => this.closeConnection(connectionId, 'device_revoked')),
    )
    return true
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
      this.teardownAllConnections('relay_disconnected', false)
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
    socket.onpong = () => {
      if (this.socket === socket) this.lastRelayActivity = Date.now()
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket) return
      // A relay that stopped answering while the socket stays half-open never emits `close`.
      // Treat silence past the stale window as a dead link and force a reconnect.
      if (Date.now() - this.lastRelayActivity > RELAY_STALE_TIMEOUT_MS) {
        socket.close?.(4001, 'relay_stale')
        return
      }
      // Use a WebSocket control frame so application traffic does not masquerade as liveness.
      socket.ping?.()
    }, RELAY_HEARTBEAT_INTERVAL_MS)
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
      await this.handleForward(frame)
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
      const deviceId = frame.deviceId
      const loginCandidate = frame.admission === 'login'
      if (!deviceId && !loginCandidate) {
        // Relay admission always carries the device binding; without it the Owner cannot tell
        // which paired device owns this connection.
        this.socket?.close?.(1008, 'invalid_client_binding')
        return
      }
      this.connectedClientIds.set(frame.connectionId, deviceId ?? 'login')
      this.connections.set(frame.connectionId, { phase: 'awaiting_handshake' })
      return
    }
    if (frame.type === 'relay.client.disconnected') {
      this.connectedClientIds.delete(frame.connectionId)
      this.teardownConnection(frame.connectionId, 'peer_disconnected')
    }
  }

  private async handleForward(frame: RelayForwardFrame) {
    // Always act on the live state: earlier awaits in this handler must not resurrect a
    // connection that another message already tore down.
    const state = this.connections.get(frame.connectionId)
    if (!state) return
    const payload = parseFrame(frame.payload)
    if (!payload) return
    if (isHandshakeFrame(payload)) {
      if (state.phase !== 'awaiting_handshake') {
        // A repeat handshake would overwrite an established session (or race a pending one).
        this.teardownConnection(frame.connectionId, 'duplicate_handshake')
        return
      }
      this.connections.set(frame.connectionId, { phase: 'handshaking' })
      await this.handleHandshake(frame.connectionId, payload)
      return
    }
    if (!isEncryptedFrame(payload)) return
    if (state.phase !== 'open') {
      this.teardownConnection(frame.connectionId, 'handshake_required')
      return
    }
    await this.handleEncrypted(frame.connectionId, state.session, payload)
  }

  private async handleHandshake(
    connectionId: string,
    frame: Extract<ReturnType<typeof parseFrame>, { type: 'handshake' }>,
  ) {
    const identity = await this.trust.identity()
    const attachedDeviceId = this.connectedClientIds.get(connectionId)
    const deviceId = await this.trust.deviceId(frame.clientPublicKey)
    const loginCandidate = attachedDeviceId === 'login'
    if (
      frame.nodeId !== identity.nodeId ||
      frame.trustEpoch !== identity.trustEpoch ||
      (!loginCandidate && (!deviceId || attachedDeviceId !== deviceId)) ||
      !this.runtimeRegistry ||
      !this.resumeSession
    ) {
      this.teardownConnection(connectionId, 'unauthorized_client')
      return
    }
    let key: SessionKey
    try {
      key = await deriveSessionKey(
        await importPrivateKey(identity.privateKey),
        await importPublicKey(frame.clientPublicKey),
        sessionKeyContext(
          identity.nodeId,
          identity.trustEpoch,
          identity.ownerPublicKey,
          frame.clientPublicKey,
        ),
      )
    } catch {
      this.teardownConnection(connectionId, 'handshake_failed')
      return
    }
    if (this.connections.get(connectionId)?.phase !== 'handshaking') return
    const transport = new VirtualOwnerTransport(
      deviceId ?? 'login',
      (ownerFrame) => void this.sendEncrypted(connectionId, ownerFrame),
      (code, reason) => this.teardownConnection(connectionId, reason, code),
    )
    if (loginCandidate) {
      transport.loginCandidate = true
      transport.clientPublicKey = frame.clientPublicKey
      transport.promote = (promotedDeviceId) => {
        transport.pairedDeviceId = promotedDeviceId
        transport.promoted = true
      }
    }
    const runtime = new OwnerSessionRuntime(transport, this.runtimeRegistry, {
      connectionId,
      resumeSession: this.resumeSession,
    })
    const session: ClientSession = {
      key,
      lastReceiveSequence: 0,
      sendSequence: 0,
      publicKey: frame.clientPublicKey,
      deviceId: deviceId ?? 'login',
      transport,
      runtime,
      createdAt: Date.now(),
    }
    this.connections.set(connectionId, { phase: 'open', session })
    // Key confirmation: the client only trusts the channel once it decrypts this record under the
    // context-bound session key, which proves the Owner derived the same key.
    await this.sendEncrypted(
      connectionId,
      encodeFrame({
        type: 'handshake.ok',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: identity.nodeId,
        trustEpoch: identity.trustEpoch,
        ownerPublicKey: identity.ownerPublicKey,
        clientPublicKey: frame.clientPublicKey,
      }),
    )
    runtime.start()
    await this.trust.markSeen(frame.clientPublicKey)
  }

  private async handleEncrypted(
    connectionId: string,
    client: ClientSession,
    frame: EncryptedFrame,
  ) {
    if (frame.sequence !== client.lastReceiveSequence + 1) return
    let plaintext: string
    try {
      plaintext = await decryptPayload(client.key, frame)
    } catch {
      this.teardownConnection(connectionId, 'invalid_encrypted_frame')
      return
    }
    if (this.connections.get(connectionId)?.phase !== 'open') return
    client.lastReceiveSequence = frame.sequence
    client.transport.receive(plaintext)
  }

  private async sendEncrypted(connectionId: string, ownerFrame: string | Uint8Array) {
    const state = this.connections.get(connectionId)
    if (state?.phase !== 'open') return
    const plaintext =
      typeof ownerFrame === 'string' ? ownerFrame : new TextDecoder().decode(ownerFrame)
    const encrypted = await encryptPayload(
      state.session.key,
      plaintext,
      ++state.session.sendSequence,
    )
    this.sendRelayPayload(connectionId, encodeFrame(encrypted))
  }

  /**
   * Ends one remote connection: notify the peer through its encrypted channel when one exists,
   * tell the relay to drop the routing slot, then release the runtime and key material.
   */
  private async closeConnection(connectionId: string, code: string) {
    // Notify the peer first so it can report a real reason, then drop the relay slot. The relay
    // close is what actually terminates the client socket.
    await this.sendEncrypted(
      connectionId,
      encodeFrame({
        type: 'connection.close',
        version: RELAY_PROTOCOL_VERSION,
        code,
      } satisfies ConnectionCloseFrame),
    )
    this.sendClose(connectionId, code)
    this.teardownConnection(connectionId, code)
  }

  private teardownConnection(connectionId: string, reason?: string, closeCode = 1008) {
    const state = this.connections.get(connectionId)
    if (!state) {
      this.connectedClientIds.delete(connectionId)
      return
    }
    this.connections.delete(connectionId)
    this.connectedClientIds.delete(connectionId)
    if (state.phase === 'open') {
      // The peer can only observe the teardown while its session key is still live, so tell the
      // relay to drop the routing slot before releasing the encrypted channel below.
      this.sendClose(connectionId, reason ?? 'connection_closed')
      state.session.transport.close(closeCode, reason)
      return
    }
    // A connection that never completed its handshake has no encrypted channel, so the peer can
    // only learn about the teardown from the relay closing that routing slot.
    this.sendClose(connectionId, reason ?? 'connection_rejected')
  }

  private async closeAllConnections(code: string) {
    const connectionIds = [...this.connections.keys()]
    await Promise.all(connectionIds.map((connectionId) => this.closeConnection(connectionId, code)))
  }

  private teardownAllConnections(reason: string, notify: boolean) {
    for (const connectionId of [...this.connections.keys()]) {
      if (notify) this.sendClose(connectionId, reason)
      this.teardownConnection(connectionId, reason)
    }
    this.connections.clear()
    this.connectedClientIds.clear()
  }

  private sendRelayPayload(connectionId: string, payload: string) {
    const frame: RelayForwardFrame = {
      type: 'relay.forward',
      version: RELAY_PROTOCOL_VERSION,
      connectionId,
      payload,
    }
    this.sendRelayFrame(frame)
  }

  private sendRelayFrame(frame: Parameters<typeof encodeFrame>[0]) {
    this.transport?.send(encodeFrame(frame))
  }

  private sendClose(connectionId: string, code: string) {
    const frame: ConnectionCloseFrame = {
      type: 'connection.close',
      version: RELAY_PROTOCOL_VERSION,
      code,
    }
    const out = this.sendRelayPayload(connectionId, encodeFrame(frame))
    return out
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

function sessionKeyContext(
  nodeId: string,
  trustEpoch: number,
  ownerKey: string,
  clientKey: string,
) {
  return `codex-web-relay/v1/${nodeId}/${trustEpoch}/${ownerKey}/${clientKey}`
}

function signRelayToken(secret: string, claims: Record<string, string | number>) {
  return signAdmissionToken(secret, { ...claims, purpose: 'paired-attach' } as never)
}
