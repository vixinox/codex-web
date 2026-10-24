import { randomUUID } from 'node:crypto'

import {
  decryptPayload,
  deriveSessionKey,
  importPrivateKey,
  importPublicKey,
  type SessionKey,
} from '@codex-web/protocol/relay/crypto'
import {
  encodeFrame,
  isEncryptedFrame,
  isHandshakeFrame,
  isPairingAcceptFrame,
  parseFrame,
  RELAY_PROTOCOL_VERSION,
  type ConnectionCloseFrame,
  type EncryptedFrame,
  type RelayForwardFrame,
} from '@codex-web/protocol/relay'

import type { ServerConfig } from '../config.js'
import { RemoteTrustStore, type PairingOffer } from './trust-store.js'

export type ConnectorTransport = {
  send(data: string): void
  close?: (code?: number, reason?: string) => void
}

type RelayWebSocket = ConnectorTransport & {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

type RelayWebSocketFactory = (url: string) => RelayWebSocket

type ClientSession = {
  key: SessionKey
  lastReceiveSequence: number
}

const defaultWebSocketFactory: RelayWebSocketFactory = (url) => {
  const WebSocketConstructor = (
    globalThis as unknown as {
      WebSocket?: new (url: string) => RelayWebSocket
    }
  ).WebSocket
  if (!WebSocketConstructor) throw new Error('WEBSOCKET_UNAVAILABLE')
  return new WebSocketConstructor(url)
}

export class OwnerConnector {
  private transport?: ConnectorTransport
  private socket?: RelayWebSocket
  private connected = false
  private running = false
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private reconnectAttempt = 0
  private readonly connectionId = randomUUID()
  private readonly clients = new Map<string, ClientSession>()
  private readonly connectedClientIds = new Set<string>()

  private readonly config: ServerConfig
  readonly trust: RemoteTrustStore
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    for (const connectionId of this.connectedClientIds)
      this.sendClose(connectionId, 'owner_shutdown')
    this.connectedClientIds.clear()
    this.clients.clear()
    this.detachTransport()
    this.socket?.close?.(1000, 'owner_shutdown')
    this.socket = undefined
  }

  attachTransport(transport: ConnectorTransport) {
    this.transport = transport
    this.connected = true
  }

  detachTransport() {
    this.transport = undefined
    this.connected = false
  }

  isConnected() {
    return this.connected
  }

  async createPairingOffer(
    relayUrl = this.config.remoteRelayUrl ?? '',
  ): Promise<PairingOffer & { relayUrl: string }> {
    if (!relayUrl) throw new Error('CODEX_REMOTE_RELAY_URL_REQUIRED')
    return this.trust.createPairingOffer(relayUrl)
  }

  async acceptPairing(challenge: string, clientPublicKey: string) {
    return this.trust.acceptPairing(challenge, clientPublicKey)
  }

  async resetRemoteTrust() {
    for (const connectionId of this.connectedClientIds) this.sendClose(connectionId, 'trust_reset')
    this.connectedClientIds.clear()
    this.clients.clear()
    return this.trust.reset()
  }

  sendFrame(frame: string) {
    this.transport?.send(frame)
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
      this.reconnectAttempt = 0
      this.attachTransport(socket)
      void this.trust.identity().then(({ nodeId }) => {
        return this.sendRelayFrame({
          type: 'relay.attach',
          version: RELAY_PROTOCOL_VERSION,
          nodeId,
          role: 'owner',
          connectionId: this.connectionId,
        })
      })
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      this.handleRelayMessage(event.data).catch(() => undefined)
    }
    socket.onerror = () => this.detachTransport()
    socket.onclose = () => {
      if (this.socket === socket) this.socket = undefined
      this.detachTransport()
      this.clients.clear()
      this.connectedClientIds.clear()
      this.scheduleReconnect()
    }
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
    if (frame.type === 'relay.client.connected') {
      this.connectedClientIds.add(frame.connectionId)
      return
    }
    if (frame.type === 'relay.client.disconnected') {
      this.clients.delete(frame.connectionId)
      this.connectedClientIds.delete(frame.connectionId)
    }
  }

  private async handleForward(frame: RelayForwardFrame) {
    const payload = parseFrame(frame.payload)
    if (isPairingAcceptFrame(payload)) {
      const identity = await this.trust.identity()
      const accepted =
        payload.nodeId === identity.nodeId &&
        (await this.trust.acceptPairing(payload.challenge, payload.clientPublicKey))
      const nextIdentity = await this.trust.identity()
      this.sendRelayPayload(
        frame.connectionId,
        encodeFrame({
          type: 'pairing.result',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: nextIdentity.nodeId,
          accepted,
          trustEpoch: nextIdentity.trustEpoch,
          ownerPublicKey: nextIdentity.ownerPublicKey,
        }),
      )
      return
    }
    if (isHandshakeFrame(payload)) {
      await this.handleHandshake(frame.connectionId, payload)
      return
    }
    if (!isEncryptedFrame(payload)) return
    await this.handleEncrypted(frame.connectionId, payload)
  }

  private async handleHandshake(
    connectionId: string,
    frame: Extract<ReturnType<typeof parseFrame>, { type: 'handshake' }>,
  ) {
    const identity = await this.trust.identity()
    if (
      frame.nodeId !== identity.nodeId ||
      frame.trustEpoch !== identity.trustEpoch ||
      !(await this.trust.isAuthorized(frame.clientPublicKey))
    ) {
      this.sendClose(connectionId, 'unauthorized_client')
      return
    }
    const key = await deriveSessionKey(
      await importPrivateKey(identity.privateKey),
      await importPublicKey(frame.clientPublicKey),
    )
    this.clients.set(connectionId, { key, lastReceiveSequence: 0 })
    await this.trust.markSeen(frame.clientPublicKey)
  }

  private async handleEncrypted(connectionId: string, frame: EncryptedFrame) {
    const client = this.clients.get(connectionId)
    if (!client || frame.sequence <= client.lastReceiveSequence) return
    let inner
    try {
      inner = parseFrame(await decryptPayload(client.key, frame))
    } catch {
      this.clients.delete(connectionId)
      this.sendClose(connectionId, 'invalid_encrypted_frame')
      return
    }
    client.lastReceiveSequence = frame.sequence
    if (!inner) return
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
    this.sendRelayPayload(connectionId, encodeFrame(frame))
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
