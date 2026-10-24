import {
  encodeFrame,
  isRelayForwardFrame,
  parseFrame,
  type ConnectionRole,
  type RelayAttachFrame,
  type RelayClientConnectedFrame,
  type RelayClientDisconnectedFrame,
} from '@codex-web/protocol/relay'

export type RelaySocket = {
  send(data: string | ArrayBuffer | Uint8Array): void
  close(code?: number, reason?: string): void
}

export type RelaySession = {
  sessionId: string
  nodeId: string
  connectionId: string
  role: ConnectionRole
  socket: RelaySocket
}

export type RelayAttachResult =
  | { ok: true; session: RelaySession; replaced?: RelaySession }
  | { ok: false; reason: 'duplicate_role' | 'invalid_attachment' }

type RelayNode = {
  owner?: RelaySession
  clients: Map<string, RelaySession>
}

export class RelayRouter {
  private readonly nodes = new Map<string, RelayNode>()
  private readonly sessions = new Map<string, RelaySession>()

  attach(attachment: RelayAttachFrame, socket: RelaySocket): RelayAttachResult {
    if (!attachment.nodeId || !attachment.connectionId) {
      return { ok: false, reason: 'invalid_attachment' }
    }
    const node = this.nodes.get(attachment.nodeId) ?? this.createNode()
    const existing =
      attachment.role === 'owner' ? node.owner : node.clients.get(attachment.connectionId)
    const session: RelaySession = {
      sessionId: crypto.randomUUID(),
      nodeId: attachment.nodeId,
      connectionId: attachment.connectionId,
      role: attachment.role,
      socket,
    }
    if (attachment.role === 'owner') {
      node.owner = session
      if (existing) this.removeSession(existing, 'replaced')
      for (const client of node.clients.values()) this.notifyConnected(session, client)
    } else {
      node.clients.set(attachment.connectionId, session)
      if (existing) this.removeSession(existing, 'replaced')
      this.notifyConnected(node.owner, session)
    }
    this.nodes.set(attachment.nodeId, node)
    this.sessions.set(session.sessionId, session)
    return { ok: true, session, ...(existing ? { replaced: existing } : {}) }
  }

  detach(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    this.removeSession(session, 'peer_disconnected')
  }

  forward(sessionId: string, data: string | ArrayBuffer | Uint8Array): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.role !== 'owner' || typeof data !== 'string') return false
    const frame = parseFrame(data)
    if (!isRelayForwardFrame(frame)) return false
    const peer = this.nodes.get(session.nodeId)?.clients.get(frame.connectionId)
    if (!peer) return false
    peer.socket.send(data)
    return true
  }

  forwardFromClient(sessionId: string, data: string | ArrayBuffer | Uint8Array): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.role !== 'client' || typeof data !== 'string') return false
    const frame = parseFrame(data)
    if (!isRelayForwardFrame(frame) || frame.connectionId !== session.connectionId) return false
    const owner = this.nodes.get(session.nodeId)?.owner
    if (!owner) return false
    owner.socket.send(data)
    return true
  }

  connectionCount() {
    return this.sessions.size
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  private notifyConnected(owner: RelaySession | undefined, client: RelaySession) {
    if (!owner) return
    const frame: RelayClientConnectedFrame = {
      type: 'relay.client.connected',
      version: 1,
      nodeId: client.nodeId,
      connectionId: client.connectionId,
    }
    owner.socket.send(encodeFrame(frame))
  }

  private createNode(): RelayNode {
    return { clients: new Map<string, RelaySession>() }
  }

  private removeSession(session: RelaySession, reason: string) {
    this.sessions.delete(session.sessionId)
    const node = this.nodes.get(session.nodeId)
    if (!node) return
    if (session.role === 'owner') {
      if (node.owner?.sessionId === session.sessionId) delete node.owner
      for (const client of node.clients.values()) client.socket.close(4002, reason)
      node.clients.clear()
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
    if (!node.owner && !node.clients.size) this.nodes.delete(session.nodeId)
    session.socket.close(4002, reason)
  }
}
