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
  type RelayEnrollmentRegisterFrame,
} from '@codex-web/protocol/relay'
import type { Logger } from '@codex-web/telemetry/logger'
import { TelemetryErrorCode } from '@codex-web/telemetry/errors'

import {
  mapRelayConnectionClose,
  type RelayConnectionCloseCode,
  type RelayFailureCode,
} from './close-policy.js'
import { containRelayLogger, nullRelayLogger, safeRelayIdentifier } from './logging.js'

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
  admission?: 'paired' | 'enrollment'
  deviceId?: string
  ownerCode?: string
  reference?: string
  ownerPublicKey?: string
  rateTokens: number
  lastRateUpdate: number
}

export type RelayAttachResult =
  | { ok: true; session: RelaySession; replaced?: RelaySession }
  | { ok: false; code: RelayFailureCode }

export type RelayOperationResult = { ok: true } | { ok: false; code: RelayFailureCode }

export type RelayRouterOptions = {
  ownerToken: string
  logger?: Logger
  maxConnections?: number
  maxClientsPerNode?: number
  maxFrameBytes?: number
  messagesPerSecond?: number
  maxQueuedBytes?: number
}

type RelayNode = {
  owner?: RelaySession
  ownerCode?: string
  enrollmentReferences: Set<string>
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
  private readonly enrollmentReferences = new Map<string, { nodeId: string; expiresAt: number }>()
  private readonly sessions = new Map<string, RelaySession>()
  private readonly options: RelayRouterOptions
  private readonly logger: Logger

  constructor(options: RelayRouterOptions) {
    this.options = options
    this.logger = containRelayLogger(options.logger ?? nullRelayLogger).child({ service: 'relay' })
  }

  attach(attachment: RelayAttachFrame, socket: RelaySocket): RelayAttachResult {
    if (attachment.role === 'client' && attachment.admission === 'enrollment')
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
      return this.rejectAttach(TelemetryErrorCode.relayAttachInvalidFrame, attachment)
    }
    const epoch = trustEpoch as number
    const existingNode = this.nodes.get(attachment.nodeId)
    if (attachment.role === 'owner' && !isOwnerCode(attachment.ownerCode))
      return this.rejectAttach(TelemetryErrorCode.relayAttachInvalidFrame, attachment)
    const existing =
      attachment.role === 'owner'
        ? existingNode?.owner
        : existingNode?.clients.get(attachment.connectionId)
    if (this.sessions.size >= (this.options.maxConnections ?? DEFAULT_MAX_CONNECTIONS) && !existing)
      return this.rejectAttach(TelemetryErrorCode.relayAttachCapacity, attachment)
    if (attachment.role === 'client') {
      if (
        !existingNode?.owner ||
        existingNode.trustEpoch !== epoch ||
        !verifyClientToken(attachment, this.options.ownerToken, epoch)
      )
        return this.rejectAttach(TelemetryErrorCode.relayAttachUnauthorized, attachment)
    } else if (
      !verifyToken(
        attachment.ownerToken,
        this.options.ownerToken,
        attachment.nodeId,
        epoch,
        'owner',
      )
    ) {
      return this.rejectAttach(TelemetryErrorCode.relayAttachUnauthorized, attachment)
    }
    if (
      attachment.role === 'owner' &&
      this.ownerCodes.has(attachment.ownerCode) &&
      this.ownerCodes.get(attachment.ownerCode) !== attachment.nodeId
    )
      return this.rejectAttach(TelemetryErrorCode.relayAttachOwnerConflict, attachment)
    const node = existingNode ?? this.createNode()
    if (attachment.role === 'owner') node.trustEpoch = epoch
    if (
      attachment.role === 'client' &&
      !node.clients.has(attachment.connectionId) &&
      node.clients.size >= (this.options.maxClientsPerNode ?? DEFAULT_MAX_CLIENTS_PER_NODE)
    )
      return this.rejectAttach(TelemetryErrorCode.relayAttachCapacity, attachment)
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
      ...(attachment.role === 'owner' ? { ownerPublicKey: attachment.ownerPublicKey } : {}),
      ...(attachment.role === 'client' && existingNode?.owner?.ownerPublicKey
        ? { ownerPublicKey: existingNode.owner.ownerPublicKey }
        : {}),
      rateTokens: this.options.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND,
      lastRateUpdate: Date.now(),
    }
    if (attachment.role === 'owner') {
      if (existingNode?.ownerCode && existingNode.ownerCode !== attachment.ownerCode)
        this.removeOwnerCode(existingNode.ownerCode, attachment.nodeId)
      if (existingNode?.owner && existingNode.owner.sessionId !== session.sessionId) {
        for (const reference of existingNode.enrollmentReferences)
          this.removeEnrollmentReference(reference, attachment.nodeId)
      }
      this.ownerCodes.set(attachment.ownerCode, attachment.nodeId)
      node.ownerCode = attachment.ownerCode
      node.owner = session
    } else {
      node.clients.set(attachment.connectionId, session)
    }
    this.nodes.set(attachment.nodeId, node)
    this.sessions.set(session.sessionId, session)
    if (existing) this.removeSession(existing, TelemetryErrorCode.relayConnectionReplaced)
    if (attachment.role === 'owner') {
      for (const client of node.clients.values()) this.notifyConnected(session, client)
    } else {
      this.notifyConnected(node.owner, session)
    }
    this.logger.info('relay.attach.accepted', {
      role: session.role,
      ...(safeRelayIdentifier(session.nodeId)
        ? { nodeId: safeRelayIdentifier(session.nodeId) }
        : {}),
      ...(safeRelayIdentifier(session.connectionId)
        ? { connectionId: safeRelayIdentifier(session.connectionId) }
        : {}),
    })
    return { ok: true, session, ...(existing ? { replaced: existing } : {}) }
  }

  detach(sessionId: string) {
    if (!this.sessions.has(sessionId)) return
    this.removeSession(
      this.sessions.get(sessionId)!,
      TelemetryErrorCode.relayConnectionPeerDisconnected,
    )
  }

  forward(sessionId: string, data: string | ArrayBuffer | Uint8Array): RelayOperationResult {
    const session = this.sessions.get(sessionId)
    if (!session) return this.rejectMissingSession()
    if (session.role !== 'owner' || typeof data !== 'string')
      return this.rejectFrame(TelemetryErrorCode.relayFrameInvalid)
    const frameBytes = encoder.encode(data).byteLength
    if (frameBytes > this.maxFrameBytes)
      return this.rejectFrame(TelemetryErrorCode.relayFrameTooLarge)
    if (!this.consumeRateToken(session))
      return this.rejectFrame(TelemetryErrorCode.relayFrameInvalid)
    const frame = parseFrame(data)
    if (!isRelayForwardFrame(frame)) return this.rejectFrame(TelemetryErrorCode.relayFrameInvalid)
    if (isClosePayload(frame.payload)) {
      // The owner asked to terminate that connection; the relay owns socket lifetime, so it drops
      // the addressed slot. The peer already received the explanation inside the opaque payload.
      const target = this.nodes.get(session.nodeId)?.clients.get(frame.connectionId)
      if (target) {
        if (!this.hasOutboundCapacity(target.socket, frameBytes)) {
          this.removeSession(target, TelemetryErrorCode.relayConnectionSlowConsumer)
          return { ok: true }
        }
        target.socket.send(data)
        this.removeSession(target, TelemetryErrorCode.relayConnectionClosedByOwner)
      }
      return { ok: true }
    }
    const peer = this.nodes.get(session.nodeId)?.clients.get(frame.connectionId)
    // The target connection can disappear between the owner writing and the relay reading (a
    // rejected or replaced client). That is a dropped frame for one peer, not a fault of the
    // owner's own socket, so report it as handled.
    if (!peer) return { ok: true }
    if (!this.hasOutboundCapacity(peer.socket, frameBytes)) {
      this.removeSession(peer, TelemetryErrorCode.relayConnectionSlowConsumer)
      return { ok: true }
    }
    peer.socket.send(data)
    return { ok: true }
  }

  forwardFromClient(
    sessionId: string,
    data: string | ArrayBuffer | Uint8Array,
  ): RelayOperationResult {
    const session = this.sessions.get(sessionId)
    if (!session) return this.rejectMissingSession()
    if (session.role !== 'client' || typeof data !== 'string')
      return this.rejectFrame(TelemetryErrorCode.relayFrameInvalid)
    const frameBytes = encoder.encode(data).byteLength
    if (frameBytes > this.maxFrameBytes)
      return this.rejectFrame(TelemetryErrorCode.relayFrameTooLarge)
    if (!this.consumeRateToken(session))
      return this.rejectFrame(TelemetryErrorCode.relayFrameInvalid)
    const frame = parseFrame(data)
    if (!isRelayForwardFrame(frame) || frame.connectionId !== session.connectionId)
      return this.rejectFrame(TelemetryErrorCode.relayFrameInvalid)
    const owner = this.nodes.get(session.nodeId)?.owner
    if (!owner) return { ok: true }
    if (!this.hasOutboundCapacity(owner.socket, frameBytes)) {
      this.removeSession(session, TelemetryErrorCode.relayConnectionSlowConsumer)
      return { ok: true }
    }
    owner.socket.send(data)
    return { ok: true }
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

  resolveEnrollmentReference(
    reference: string,
  ):
    | { ok: true; nodeId: string; trustEpoch: number }
    | { ok: false; code: typeof TelemetryErrorCode.relayEnrollmentReferenceInvalid } {
    const mapping = this.enrollmentReferences.get(reference)
    if (!mapping || mapping.expiresAt <= Date.now()) {
      if (mapping) this.removeEnrollmentReference(reference, mapping.nodeId)
      this.logger.warn('relay.enrollment.reference.rejected', {
        code: TelemetryErrorCode.relayEnrollmentReferenceInvalid,
        action: 'resolve',
      })
      return this.invalidEnrollmentReference('resolve')
    }
    const node = this.nodes.get(mapping.nodeId)
    if (!node?.owner || !node.enrollmentReferences.has(reference)) {
      this.removeEnrollmentReference(reference, mapping.nodeId)
      this.logger.warn('relay.enrollment.reference.rejected', {
        code: TelemetryErrorCode.relayEnrollmentReferenceInvalid,
        action: 'resolve',
      })
      return this.invalidEnrollmentReference('resolve')
    }
    return { ok: true, nodeId: mapping.nodeId, trustEpoch: node.trustEpoch }
  }

  registerEnrollmentReference(
    sessionId: string,
    frame: RelayEnrollmentRegisterFrame,
  ): RelayOperationResult {
    const session = this.sessions.get(sessionId)
    if (!session || session.role !== 'owner' || frame.expiresAt <= Date.now())
      return this.invalidEnrollmentReference('register')
    const node = this.nodes.get(session.nodeId)
    if (!node?.owner || node.owner.sessionId !== sessionId)
      return this.invalidEnrollmentReference('register')
    const existing = this.enrollmentReferences.get(frame.reference)
    if (existing && existing.expiresAt <= Date.now())
      this.removeEnrollmentReference(frame.reference, existing.nodeId)
    if (existing && existing.nodeId !== session.nodeId)
      return this.invalidEnrollmentReference('register')
    for (const reference of node.enrollmentReferences)
      this.removeEnrollmentReference(reference, session.nodeId)
    this.enrollmentReferences.set(frame.reference, {
      nodeId: session.nodeId,
      expiresAt: frame.expiresAt,
    })
    node.enrollmentReferences.add(frame.reference)
    this.logger.info('relay.enrollment.reference.registered', {
      ...(safeRelayIdentifier(session.connectionId)
        ? { connectionId: safeRelayIdentifier(session.connectionId) }
        : {}),
    })
    return { ok: true }
  }

  unregisterEnrollmentReference(sessionId: string, reference?: string): RelayOperationResult {
    const session = this.sessions.get(sessionId)
    if (!session || session.role !== 'owner') return this.invalidEnrollmentReference('unregister')
    const node = this.nodes.get(session.nodeId)
    if (!node?.owner || node.owner.sessionId !== sessionId)
      return this.invalidEnrollmentReference('unregister')
    if (reference) {
      const mapping = this.enrollmentReferences.get(reference)
      if (!mapping || mapping.nodeId !== session.nodeId)
        return this.invalidEnrollmentReference('unregister')
      this.removeEnrollmentReference(reference, session.nodeId)
    } else {
      for (const active of node.enrollmentReferences)
        this.removeEnrollmentReference(active, session.nodeId)
    }
    this.logger.info('relay.enrollment.reference.unregistered', {
      ...(safeRelayIdentifier(session.connectionId)
        ? { connectionId: safeRelayIdentifier(session.connectionId) }
        : {}),
    })
    return { ok: true }
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  get maxFrameBytes() {
    return this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
  }

  /** Closes a routing slot from the router side without trusting the socket's own close callback. */
  close(sessionId: string, reason: RelayConnectionCloseCode): RelayOperationResult {
    const session = this.sessions.get(sessionId)
    if (!session) return this.rejectMissingSession()
    this.removeSession(session, reason)
    return { ok: true }
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
      ...(client.admission === 'enrollment'
        ? {
            admission: client.admission,
            reference: client.reference!,
            ownerPublicKey: owner.ownerPublicKey!,
          }
        : { deviceId: client.deviceId! }),
    }
    owner.socket.send(encodeFrame(frame))
  }

  private createNode(): RelayNode {
    return {
      trustEpoch: 0,
      enrollmentReferences: new Set<string>(),
      clients: new Map<string, RelaySession>(),
    }
  }

  /**
   * Removes a session exactly once. Callers may reach this from the socket close callback, from a
   * replacement attach, or from an explicit router close; the session presence check makes every
   * repeated path a no-op so peers are never closed twice and node entries never leak.
   */
  private removeSession(session: RelaySession, reason: RelayConnectionCloseCode) {
    if (!this.sessions.delete(session.sessionId)) return
    this.logConnectionClose(session, reason)
    const close = mapRelayConnectionClose(reason)
    const node = this.nodes.get(session.nodeId)
    if (!node) {
      session.socket.close(close.code, close.reason)
      return
    }
    if (session.role === 'owner') {
      if (node.owner?.sessionId === session.sessionId) {
        delete node.owner
        if (session.ownerCode) this.removeOwnerCode(session.ownerCode, session.nodeId)
        if (node.ownerCode === session.ownerCode) delete node.ownerCode
        for (const reference of node.enrollmentReferences)
          this.removeEnrollmentReference(reference, session.nodeId)
      }
      const clients = [...node.clients.values()]
      node.clients.clear()
      for (const client of clients) {
        // Owner loss is a connection-level event: clients reconnect and re-handshake, so no
        // `relay.client.disconnected` is owed to an owner that is no longer there.
        if (this.sessions.delete(client.sessionId)) {
          this.logConnectionClose(client, reason)
          client.socket.close(close.code, close.reason)
        }
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
    session.socket.close(close.code, close.reason)
  }

  private removeOwnerCode(ownerCode: string, nodeId: string) {
    if (this.ownerCodes.get(ownerCode) === nodeId) this.ownerCodes.delete(ownerCode)
  }

  private removeEnrollmentReference(reference: string, nodeId: string) {
    const mapping = this.enrollmentReferences.get(reference)
    if (mapping?.nodeId === nodeId) this.enrollmentReferences.delete(reference)
    const node = this.nodes.get(nodeId)
    node?.enrollmentReferences.delete(reference)
  }

  private attachLoginCandidate(
    attachment: Extract<RelayAttachFrame, { role: 'client'; admission: 'enrollment' }>,
    socket: RelaySocket,
  ): RelayAttachResult {
    if (
      !attachment.connectionId ||
      encoder.encode(attachment.connectionId).byteLength > MAX_ROUTE_ID_BYTES ||
      !isRouteReference(attachment.reference)
    )
      return this.rejectAttach(TelemetryErrorCode.relayEnrollmentReferenceInvalid, attachment)
    const reference = attachment.reference
    const mapping = this.enrollmentReferences.get(reference)
    if (mapping && mapping.expiresAt <= Date.now())
      this.removeEnrollmentReference(reference, mapping.nodeId)
    const nodeId = this.enrollmentReferences.get(reference)?.nodeId
    const node = nodeId ? this.nodes.get(nodeId) : undefined
    if (!nodeId || !node?.owner || !node.enrollmentReferences.has(reference))
      return this.rejectAttach(TelemetryErrorCode.relayAttachUnauthorized, attachment)
    if (this.sessions.size >= (this.options.maxConnections ?? DEFAULT_MAX_CONNECTIONS))
      return this.rejectAttach(TelemetryErrorCode.relayAttachCapacity, attachment)
    if (node.clients.has(attachment.connectionId))
      return this.rejectAttach(TelemetryErrorCode.relayAttachDuplicate, attachment)
    if (node.clients.size >= (this.options.maxClientsPerNode ?? DEFAULT_MAX_CLIENTS_PER_NODE))
      return this.rejectAttach(TelemetryErrorCode.relayAttachCapacity, attachment)
    const session: RelaySession = {
      sessionId: randomUUID(),
      nodeId,
      connectionId: attachment.connectionId,
      trustEpoch: node.trustEpoch,
      role: 'client',
      socket,
      admission: attachment.admission,
      reference,
      ...(node.owner?.ownerPublicKey ? { ownerPublicKey: node.owner.ownerPublicKey } : {}),
      rateTokens: this.options.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND,
      lastRateUpdate: Date.now(),
    }
    node.clients.set(attachment.connectionId, session)
    this.sessions.set(session.sessionId, session)
    this.notifyConnected(node.owner, session)
    this.logger.info('relay.attach.accepted', {
      role: session.role,
      ...(safeRelayIdentifier(session.nodeId)
        ? { nodeId: safeRelayIdentifier(session.nodeId) }
        : {}),
      ...(safeRelayIdentifier(session.connectionId)
        ? { connectionId: safeRelayIdentifier(session.connectionId) }
        : {}),
    })
    return { ok: true, session }
  }

  private rejectAttach(code: RelayFailureCode, attachment: RelayAttachFrame): RelayAttachResult {
    const fields = {
      code,
      role: attachment.role,
      ...('nodeId' in attachment && safeRelayIdentifier(attachment.nodeId)
        ? { nodeId: safeRelayIdentifier(attachment.nodeId) }
        : {}),
      ...(safeRelayIdentifier(attachment.connectionId)
        ? { connectionId: safeRelayIdentifier(attachment.connectionId) }
        : {}),
    }
    this.logger.warn(
      code === TelemetryErrorCode.relayAttachOwnerConflict
        ? 'relay.attach.owner-conflict'
        : 'relay.attach.rejected',
      fields,
    )
    return { ok: false, code }
  }

  private rejectFrame(code: RelayFailureCode): RelayOperationResult {
    this.logger.warn('relay.frame.rejected', { code })
    return { ok: false, code }
  }

  private rejectMissingSession(): RelayOperationResult {
    const code = TelemetryErrorCode.relayConnectionPeerDisconnected
    this.logger.warn('relay.connection.operation-rejected', { code })
    return { ok: false, code }
  }

  private invalidEnrollmentReference(action: 'resolve' | 'register' | 'unregister'): {
    ok: false
    code: typeof TelemetryErrorCode.relayEnrollmentReferenceInvalid
  } {
    if (action !== 'resolve')
      this.logger.warn('relay.enrollment.reference.rejected', {
        action,
        code: TelemetryErrorCode.relayEnrollmentReferenceInvalid,
      })
    return { ok: false, code: TelemetryErrorCode.relayEnrollmentReferenceInvalid }
  }

  private logConnectionClose(session: RelaySession, code: RelayConnectionCloseCode) {
    const event =
      code === TelemetryErrorCode.relayConnectionReplaced
        ? 'relay.connection.replaced'
        : 'relay.connection.closed'
    this.logger.info(event, {
      code,
      role: session.role,
      ...(safeRelayIdentifier(session.nodeId)
        ? { nodeId: safeRelayIdentifier(session.nodeId) }
        : {}),
      ...(safeRelayIdentifier(session.connectionId)
        ? { connectionId: safeRelayIdentifier(session.connectionId) }
        : {}),
    })
  }
}

function isOwnerCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{9}$/.test(value)
}

function isRouteReference(value: unknown): value is string {
  return typeof value === 'string' && encoder.encode(value).byteLength <= MAX_ROUTE_ID_BYTES
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
