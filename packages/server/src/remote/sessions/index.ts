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

import { log } from '../../logger.js'
import {
  OwnerSessionRuntime,
  VirtualOwnerTransport,
  type OwnerMethodRegistry,
} from '../../owner/session-runtime.js'
import { RemoteTrustStore } from '../trust-store.js'

type ClientSession = {
  key: SessionKey
  lastReceiveSequence: number
  sendSequence: number
  sendQueue: Promise<void>
  closing?: boolean
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

/** Owns client handshake, encryption and Owner runtime lifecycles for one Relay link. */
export class RemoteClientSessions {
  private readonly connections = new Map<string, ConnectionState>()
  private readonly connectedClientIds = new Map<string, string>()
  private readonly connectedEnrollmentReferences = new Map<string, string>()
  private revocationRevision = 0
  private runtimeRegistry?: OwnerMethodRegistry
  private authorizeDevice?: (deviceId: string) => Promise<boolean>
  private resumeSession?: NonNullable<
    ConstructorParameters<typeof OwnerSessionRuntime>[2]['resumeSession']
  >
  private readonly trust: RemoteTrustStore
  private readonly sendFrame: (frame: Parameters<typeof encodeFrame>[0]) => void
  constructor(
    trust: RemoteTrustStore,
    sendFrame: (frame: Parameters<typeof encodeFrame>[0]) => void,
  ) {
    this.trust = trust
    this.sendFrame = sendFrame
  }
  attach(connectionId: string, deviceId: string, reference?: string) {
    this.connectedClientIds.set(connectionId, deviceId)
    if (reference !== undefined) this.connectedEnrollmentReferences.set(connectionId, reference)
    this.connections.set(connectionId, { phase: 'awaiting_handshake' })
  }
  detach(connectionId: string) {
    this.connectedClientIds.delete(connectionId)
    this.connectedEnrollmentReferences.delete(connectionId)
    this.teardownConnection(connectionId, 'peer_disconnected')
  }
  invalidateHandshakes() {
    this.revocationRevision += 1
  }
  configureRemoteSessions(
    registry: OwnerMethodRegistry,
    resumeSession: NonNullable<
      ConstructorParameters<typeof OwnerSessionRuntime>[2]['resumeSession']
    >,
    authorizeDevice?: (deviceId: string) => Promise<boolean>,
  ) {
    this.authorizeDevice = authorizeDevice
    this.runtimeRegistry = registry
    this.resumeSession = resumeSession
  }

  async disconnectDevice(deviceId?: string, reason = 'access_unavailable', publicKey?: string) {
    const ids = [...this.connections].flatMap(([id, state]) =>
      state.phase === 'open' &&
      (!deviceId ||
        state.session.deviceId === deviceId ||
        (publicKey && state.session.publicKey === publicKey))
        ? [id]
        : [],
    )
    await Promise.all(ids.map((id) => this.closeConnection(id, reason)))
  }

  async handleForward(frame: RelayForwardFrame) {
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
    const revocationRevision = this.revocationRevision
    const identity = await this.trust.identity()
    const attachedDeviceId = this.connectedClientIds.get(connectionId)
    const deviceId = await this.trust.deviceId(frame.clientPublicKey)
    const enrollmentCandidate = attachedDeviceId === 'enrollment'
    if (
      frame.nodeId !== identity.nodeId ||
      frame.trustEpoch !== identity.trustEpoch ||
      (!enrollmentCandidate && (!deviceId || attachedDeviceId !== deviceId)) ||
      !this.runtimeRegistry ||
      !this.resumeSession
    ) {
      log.warn('owner.remote.handshake-rejected', {
        clientType: enrollmentCandidate ? 'enrollment' : 'paired',
      })
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
    if (
      !enrollmentCandidate &&
      ((await this.trust.deviceId(frame.clientPublicKey)) !== deviceId ||
        (this.authorizeDevice && !(await this.authorizeDevice(deviceId!))))
    ) {
      this.teardownConnection(connectionId, 'unauthorized_client')
      return
    }
    if (revocationRevision !== this.revocationRevision) {
      this.teardownConnection(connectionId, 'unauthorized_client')
      return
    }
    if (this.connections.get(connectionId)?.phase !== 'handshaking') return
    const transport = new VirtualOwnerTransport(
      deviceId ?? 'enrollment',
      (ownerFrame) => void this.sendEncrypted(connectionId, ownerFrame),
      (code, reason) => this.requestConnectionClose(connectionId, code, reason),
    )
    transport.clientPublicKey = frame.clientPublicKey
    if (enrollmentCandidate) {
      transport.enrollmentCandidate = true
      const enrollmentReference = this.connectedEnrollmentReferences.get(connectionId)
      if (enrollmentReference) transport.enrollmentReference = enrollmentReference
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
      sendQueue: Promise.resolve(),
      publicKey: frame.clientPublicKey,
      deviceId: deviceId ?? 'enrollment',
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
    if (
      !client.transport.enrollmentCandidate &&
      this.authorizeDevice &&
      !(await this.authorizeDevice(client.deviceId))
    ) {
      await this.closeConnection(connectionId, 'device_revoked')
      return
    }
    if (this.connections.get(connectionId)?.phase !== 'open') return
    client.lastReceiveSequence = frame.sequence
    client.transport.receive(plaintext)
  }

  private async sendEncrypted(connectionId: string, ownerFrame: string | Uint8Array) {
    const state = this.connections.get(connectionId)
    if (state?.phase !== 'open') return
    const session = state.session
    const send = session.sendQueue.then(async () => {
      const current = this.connections.get(connectionId)
      if (current?.phase !== 'open' || current.session !== session) return undefined
      const plaintext =
        typeof ownerFrame === 'string' ? ownerFrame : new TextDecoder().decode(ownerFrame)
      const encrypted = await encryptPayload(session.key, plaintext, ++session.sendSequence)
      this.sendRelayPayload(connectionId, encodeFrame(encrypted))
      return undefined
    })
    session.sendQueue = send.catch(() => undefined)
    await send
  }

  private requestConnectionClose(connectionId: string, closeCode?: number, reason?: string) {
    if (!this.connections.has(connectionId)) return
    void this.closeConnection(connectionId, reason ?? 'connection_closed', closeCode)
  }

  /**
   * Ends one remote connection: notify the peer through its encrypted channel when one exists,
   * tell the relay to drop the routing slot, then release the runtime and key material.
   */
  private async closeConnection(connectionId: string, code: string, closeCode = 1000) {
    const state = this.connections.get(connectionId)
    if (state?.phase === 'open' && state.session.closing) return
    if (state?.phase === 'open') state.session.closing = true
    // Notify the peer first so it can report a real reason, then drop the relay slot. The relay
    // close is what actually terminates the client socket.
    try {
      await this.sendEncrypted(
        connectionId,
        encodeFrame({
          type: 'connection.close',
          version: RELAY_PROTOCOL_VERSION,
          code,
        } satisfies ConnectionCloseFrame),
      )
    } finally {
      this.teardownConnection(connectionId, code, closeCode)
    }
  }

  private teardownConnection(connectionId: string, reason?: string, closeCode = 1008) {
    const state = this.connections.get(connectionId)
    if (!state) {
      this.connectedClientIds.delete(connectionId)
      return
    }
    this.connections.delete(connectionId)
    this.connectedClientIds.delete(connectionId)
    this.connectedEnrollmentReferences.delete(connectionId)
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

  async closeAllConnections(code: string) {
    const connectionIds = [...this.connections.keys()]
    await Promise.all(connectionIds.map((connectionId) => this.closeConnection(connectionId, code)))
  }

  teardownAllConnections(reason: string, notify: boolean) {
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
    this.sendFrame(frame)
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

function sessionKeyContext(
  nodeId: string,
  trustEpoch: number,
  ownerKey: string,
  clientKey: string,
) {
  return `codex-web-relay/v1/${nodeId}/${trustEpoch}/${ownerKey}/${clientKey}`
}
