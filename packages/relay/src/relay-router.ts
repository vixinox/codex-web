import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'

import {
  encodeFrame,
  isRelayForwardFrame,
  MAX_ROUTE_ID_BYTES,
  parseFrame,
  type ConnectionRole,
  type RelayAttachFrame,
  type RelayClientConnectedFrame,
  type RelayClientDisconnectedFrame,
} from '@codex-web/protocol/relay'

export type RelaySocket = {
  send(data: string | ArrayBuffer | Uint8Array): void
  close(code?: number, reason?: string): void
  ping?: () => void
  onpong?: (() => void) | null
  bufferedAmount?(): number
}

export type RelaySession = {
  sessionId: string
  nodeId: string
  connectionId: string
  trustEpoch: number
  role: ConnectionRole
  socket: RelaySocket
  admission?: 'paired' | 'login'
  deviceId?: string
  ownerCode?: string
  rateTokens: number
  lastRateUpdate: number
}

export type RelayAttachResult =
  | { ok: true; session: RelaySession; replaced?: RelaySession }
  | {
      ok: false
      reason:
        | 'duplicate_role'
        | 'invalid_attachment'
        | 'capacity'
        | 'unauthorized'
        | 'owner_code_conflict'
    }

export type RelayRouterOptions = {
  ownerToken: string
  maxConnections?: number
  maxClientsPerNode?: number
  maxFrameBytes?: number
  messagesPerSecond?: number
  maxQueuedBytes?: number
}

type RelayNode = {
  owner?: RelaySession
  ownerCode?: string
  trustEpoch: number
  clients: Map<string, RelaySession>
}

const DEFAULT_MAX_CONNECTIONS = 10_000
const DEFAULT_MAX_CLIENTS_PER_NODE = 8
const DEFAULT_MAX_FRAME_BYTES = 2 * 1024 * 1024
const DEFAULT_MESSAGES_PER_SECOND = 250
const DEFAULT_MAX_QUEUED_BYTES = 8 * 1024 * 1024
const encoder = new TextEncoder()

export class RelayRouter {
  private readonly nodes = new Map<string, RelayNode>()
  private readonly ownerCodes = new Map<string, string>()
  private readonly sessions = new Map<string, RelaySession>()
  private readonly options: RelayRouterOptions

  constructor(options: RelayRouterOptions) {
    this.options = options
  }

  attach(attachment: RelayAttachFrame, socket: RelaySocket): RelayAttachResult {
    if (attachment.role === 'client' && attachment.admission === 'login')
      return this.attachLoginCandidate(attachment, socket)
    const trustEpoch = attachment.trustEpoch
    if (
      !attachment.nodeId ||
      !attachment.connectionId ||
      attachment.nodeId.length > MAX_ROUTE_ID_BYTES ||
      attachment.connectionId.length > MAX_ROUTE_ID_BYTES ||
      !Number.isSafeInteger(trustEpoch) ||
      (attachment.role === 'client' &&
        (typeof attachment.deviceId !== 'string' || attachment.deviceId.length === 0))
    ) {
      return { ok: false, reason: 'invalid_attachment' }
    }
    const epoch = trustEpoch as number
    const existingNode = this.nodes.get(attachment.nodeId)
    if (attachment.role === 'owner' && !isOwnerCode(attachment.ownerCode))
      return { ok: false, reason: 'invalid_attachment' }
    const existing =
      attachment.role === 'owner'
        ? existingNode?.owner
        : existingNode?.clients.get(attachment.connectionId)
    if (this.sessions.size >= (this.options.maxConnections ?? DEFAULT_MAX_CONNECTIONS) && !existing)
      return { ok: false, reason: 'capacity' }
    if (attachment.role === 'client') {
      if (
        !existingNode?.owner ||
        existingNode.trustEpoch !== epoch ||
        !verifyClientToken(attachment, this.options.ownerToken, epoch)
      )
        return { ok: false, reason: 'unauthorized' }
    } else if (
      !verifyToken(
        attachment.ownerToken,
        this.options.ownerToken,
        attachment.nodeId,
        epoch,
        'owner',
      )
    ) {
      return { ok: false, reason: 'unauthorized' }
    }
    if (
      attachment.role === 'owner' &&
      this.ownerCodes.has(attachment.ownerCode) &&
      this.ownerCodes.get(attachment.ownerCode) !== attachment.nodeId
    )
      return { ok: false, reason: 'owner_code_conflict' }
    const node = existingNode ?? this.createNode()
    if (attachment.role === 'owner') node.trustEpoch = epoch
    if (
      attachment.role === 'client' &&
      !node.clients.has(attachment.connectionId) &&
      node.clients.size >= (this.options.maxClientsPerNode ?? DEFAULT_MAX_CLIENTS_PER_NODE)
    )
      return { ok: false, reason: 'capacity' }
    const session: RelaySession = {
      sessionId: randomUUID(),
      nodeId: attachment.nodeId,
      connectionId: attachment.connectionId,
      trustEpoch: epoch,
      role: attachment.role,
      socket,
      ...(attachment.role === 'client'
        ? {
            admission: 'paired' as const,
            deviceId: attachment.deviceId,
          }
        : {}),
      ...(attachment.role === 'owner' ? { ownerCode: attachment.ownerCode } : {}),
      rateTokens: this.options.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND,
      lastRateUpdate: Date.now(),
    }
    if (attachment.role === 'owner') {
      if (existingNode?.ownerCode && existingNode.ownerCode !== attachment.ownerCode)
        this.removeOwnerCode(existingNode.ownerCode, attachment.nodeId)
      this.ownerCodes.set(attachment.ownerCode, attachment.nodeId)
      node.ownerCode = attachment.ownerCode
      node.owner = session
    } else {
      node.clients.set(attachment.connectionId, session)
    }
    this.nodes.set(attachment.nodeId, node)
    this.sessions.set(session.sessionId, session)
    if (existing) this.removeSession(existing, 'replaced')
    if (attachment.role === 'owner') {
      for (const client of node.clients.values()) this.notifyConnected(session, client)
    } else {
      this.notifyConnected(node.owner, session)
    }
    return { ok: true, session, ...(existing ? { replaced: existing } : {}) }
  }

  detach(sessionId: string) {
    if (!this.sessions.has(sessionId)) return
    this.removeSession(this.sessions.get(sessionId)!, 'peer_disconnected')
  }

  forward(sessionId: string, data: string | ArrayBuffer | Uint8Array): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.role !== 'owner' || typeof data !== 'string') return false
    const frameBytes = encoder.encode(data).byteLength
    if (frameBytes > this.maxFrameBytes) return false
    if (!this.consumeRateToken(session)) return false
    const frame = parseFrame(data)
    if (!isRelayForwardFrame(frame)) return false
    if (isClosePayload(frame.payload)) {
      // The owner asked to terminate that connection; the relay owns socket lifetime, so it drops
      // the addressed slot. The peer already received the explanation inside the opaque payload.
      const target = this.nodes.get(session.nodeId)?.clients.get(frame.connectionId)
      if (target) {
        if (!this.hasOutboundCapacity(target.socket, frameBytes)) {
          this.removeSession(target, 'slow_consumer')
          return true
        }
        target.socket.send(data)
        this.removeSession(target, 'closed_by_owner')
      }
      return true
    }
    const peer = this.nodes.get(session.nodeId)?.clients.get(frame.connectionId)
    // The target connection can disappear between the owner writing and the relay reading (a
    // rejected or replaced client). That is a dropped frame for one peer, not a fault of the
    // owner's own socket, so report it as handled.
    if (!peer) return true
    if (!this.hasOutboundCapacity(peer.socket, frameBytes)) {
      this.removeSession(peer, 'slow_consumer')
      return true
    }
    peer.socket.send(data)
    return true
  }

  forwardFromClient(sessionId: string, data: string | ArrayBuffer | Uint8Array): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.role !== 'client' || typeof data !== 'string') return false
    const frameBytes = encoder.encode(data).byteLength
    if (frameBytes > this.maxFrameBytes) return false
    if (!this.consumeRateToken(session)) return false
    const frame = parseFrame(data)
    if (!isRelayForwardFrame(frame) || frame.connectionId !== session.connectionId) return false
    const owner = this.nodes.get(session.nodeId)?.owner
    if (!owner) return true
    if (!this.hasOutboundCapacity(owner.socket, frameBytes)) {
      this.removeSession(session, 'slow_consumer')
      return true
    }
    owner.socket.send(data)
    return true
  }

  connectionCount() {
    return this.sessions.size
  }

  resolveOwnerCode(
    ownerCode: string,
  ): { online: true; nodeId: string; trustEpoch: number } | { online: false } {
    const nodeId = this.ownerCodes.get(ownerCode)
    if (!nodeId) return { online: false }
    const node = this.nodes.get(nodeId)
    if (!node?.owner || node.ownerCode !== ownerCode) {
      this.removeOwnerCode(ownerCode, nodeId)
      return { online: false }
    }
    return { online: true, nodeId, trustEpoch: node.trustEpoch }
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  get maxFrameBytes() {
    return this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
  }

  /** Closes a routing slot from the router side without trusting the socket's own close callback. */
  close(sessionId: string, reason: string) {
    if (!this.sessions.has(sessionId)) return false
    this.removeSession(this.sessions.get(sessionId)!, reason)
    return true
  }

  private hasOutboundCapacity(socket: RelaySocket, frameBytes: number) {
    return (
      (socket.bufferedAmount?.() ?? 0) + frameBytes <=
      (this.options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES)
    )
  }

  private consumeRateToken(session: RelaySession) {
    const rate = this.options.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND
    const now = Date.now()
    session.rateTokens = Math.min(
      rate,
      session.rateTokens + ((now - session.lastRateUpdate) * rate) / 1000,
    )
    session.lastRateUpdate = now
    if (session.rateTokens < 1) return false
    session.rateTokens -= 1
    return true
  }

  private notifyConnected(owner: RelaySession | undefined, client: RelaySession) {
    if (!owner) return
    const frame: RelayClientConnectedFrame = {
      type: 'relay.client.connected',
      version: 1,
      nodeId: client.nodeId,
      connectionId: client.connectionId,
      ...(client.admission === 'login'
        ? { admission: 'login' as const, ownerCode: client.ownerCode! }
        : { deviceId: client.deviceId! }),
    }
    owner.socket.send(encodeFrame(frame))
  }

  private createNode(): RelayNode {
    return { trustEpoch: 0, clients: new Map<string, RelaySession>() }
  }

  /**
   * Removes a session exactly once. Callers may reach this from the socket close callback, from a
   * replacement attach, or from an explicit router close; the session presence check makes every
   * repeated path a no-op so peers are never closed twice and node entries never leak.
   */
  private removeSession(session: RelaySession, reason: string) {
    if (!this.sessions.delete(session.sessionId)) return
    const node = this.nodes.get(session.nodeId)
    if (!node) {
      session.socket.close(4002, reason)
      return
    }
    if (session.role === 'owner') {
      if (node.owner?.sessionId === session.sessionId) {
        delete node.owner
        if (session.ownerCode) this.removeOwnerCode(session.ownerCode, session.nodeId)
        if (node.ownerCode === session.ownerCode) delete node.ownerCode
      }
      const clients = [...node.clients.values()]
      node.clients.clear()
      for (const client of clients) {
        // Owner loss is a connection-level event: clients reconnect and re-handshake, so no
        // `relay.client.disconnected` is owed to an owner that is no longer there.
        if (this.sessions.delete(client.sessionId)) client.socket.close(4002, reason)
      }
    } else {
      if (node.clients.get(session.connectionId)?.sessionId === session.sessionId)
        node.clients.delete(session.connectionId)
      const frame: RelayClientDisconnectedFrame = {
        type: 'relay.client.disconnected',
        version: 1,
        nodeId: session.nodeId,
        connectionId: session.connectionId,
      }
      node.owner?.socket.send(encodeFrame(frame))
    }
    if (this.nodes.get(session.nodeId) === node && !node.owner && !node.clients.size)
      this.nodes.delete(session.nodeId)
    session.socket.close(4002, reason)
  }

  private removeOwnerCode(ownerCode: string, nodeId: string) {
    if (this.ownerCodes.get(ownerCode) === nodeId) this.ownerCodes.delete(ownerCode)
  }

  private attachLoginCandidate(
    attachment: Extract<RelayAttachFrame, { role: 'client'; admission: 'login' }>,
    socket: RelaySocket,
  ): RelayAttachResult {
    if (
      !isOwnerCode(attachment.ownerCode) ||
      !attachment.connectionId ||
      encoder.encode(attachment.connectionId).byteLength > MAX_ROUTE_ID_BYTES
    )
      return { ok: false, reason: 'invalid_attachment' }
    const nodeId = this.ownerCodes.get(attachment.ownerCode)
    const node = nodeId ? this.nodes.get(nodeId) : undefined
    if (!nodeId || !node?.owner || node.ownerCode !== attachment.ownerCode)
      return { ok: false, reason: 'unauthorized' }
    if (this.sessions.size >= (this.options.maxConnections ?? DEFAULT_MAX_CONNECTIONS))
      return { ok: false, reason: 'capacity' }
    if (node.clients.has(attachment.connectionId)) return { ok: false, reason: 'duplicate_role' }
    if (node.clients.size >= (this.options.maxClientsPerNode ?? DEFAULT_MAX_CLIENTS_PER_NODE))
      return { ok: false, reason: 'capacity' }
    const session: RelaySession = {
      sessionId: randomUUID(),
      nodeId,
      connectionId: attachment.connectionId,
      trustEpoch: node.trustEpoch,
      role: 'client',
      socket,
      admission: 'login',
      ownerCode: attachment.ownerCode,
      rateTokens: this.options.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND,
      lastRateUpdate: Date.now(),
    }
    node.clients.set(attachment.connectionId, session)
    this.sessions.set(session.sessionId, session)
    this.notifyConnected(node.owner, session)
    return { ok: true, session }
  }
}

function isOwnerCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{9}$/.test(value)
}

/**
 * Recognises the owner's `connection.close` envelope without decrypting anything: the payload is
 * still opaque E2EE text, but its outer relay frame is the one the owner chose.
 */
function isClosePayload(payload: string) {
  return parseFrame(payload)?.type === 'connection.close'
}

function verifyToken(
  token: string | undefined,
  secret: string,
  nodeId: string,
  trustEpoch: number,
  role: 'owner' | 'client',
  deviceId?: string,
) {
  if (typeof token !== 'string') return false
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return false
  const expected = createHmac('sha256', secret).update(encoded).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
  try {
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      nodeId?: unknown
      trustEpoch?: unknown
      role?: unknown
      expiresAt?: unknown
      deviceId?: unknown
      admission?: unknown
    }
    return (
      claims.nodeId === nodeId &&
      claims.trustEpoch === trustEpoch &&
      claims.role === role &&
      (deviceId === undefined ? claims.deviceId === undefined : claims.deviceId === deviceId) &&
      claims.admission === undefined &&
      typeof claims.expiresAt === 'number' &&
      claims.expiresAt > Date.now()
    )
  } catch {
    return false
  }
}

function verifyClientToken(
  attachment: Extract<RelayAttachFrame, { role: 'client'; admission?: undefined }>,
  secret: string,
  trustEpoch: number,
) {
  return verifyToken(
    attachment.clientToken,
    secret,
    attachment.nodeId,
    trustEpoch,
    'client',
    attachment.deviceId,
  )
}
