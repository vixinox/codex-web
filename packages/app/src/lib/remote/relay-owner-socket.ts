import { deriveSessionKey, decryptPayload, encryptPayload, importPublicKey } from './relay-crypto'
import {
  encodeFrame,
  isEncryptedFrame,
  parseFrame,
  RELAY_PROTOCOL_VERSION,
} from '@codex-web/protocol/relay'
import type { RelayAttachFrame } from '@codex-web/protocol/relay'

export type RelayTarget = {
  nodeId?: string
  trustEpoch?: number
  clientToken: string
  deviceId?: string
  publicKey: string
  privateKey: CryptoKey
  enrollmentReference?: string
  expectedOwnerPublicKey?: string
}

export function createRelayOwnerSocket(url: string, target: RelayTarget): WebSocket {
  const socket = new WebSocket(url)
  let connectionId: string | null = null
  let relayNodeId: string | null = null
  let relayTrustEpoch: number | null = null
  let relayOwnerPublicKey: string | null = null
  let key: CryptoKey | null = null
  let sendSequence = 0
  let receiveSequence = 0
  let pendingOpen: (() => void) | null = null
  let pendingError: ((error: Error) => void) | null = null
  let handshakeStarted = false
  const queued: string[] = []
  const originalSend = socket.send.bind(socket)

  socket.send = ((value: string) => {
    if (!key || !connectionId) {
      queued.push(value)
      return
    }
    void encryptPayload(key, value, ++sendSequence).then((encrypted) => {
      originalSend(
        encodeFrame({
          type: 'relay.forward',
          version: RELAY_PROTOCOL_VERSION,
          connectionId: connectionId!,
          payload: encodeFrame(encrypted),
        }),
      )
      return undefined
    })
  }) as typeof socket.send

  socket.addEventListener('open', () => {
    const attachConnectionId = crypto.randomUUID()
    let frame: RelayAttachFrame
    if (target.enrollmentReference) {
      frame = {
        type: 'relay.attach',
        version: RELAY_PROTOCOL_VERSION,
        role: 'client',
        connectionId: attachConnectionId,
        admission: 'enrollment',
        reference: target.enrollmentReference,
      }
    } else {
      if (!target.nodeId || target.trustEpoch === undefined || !target.deviceId) {
        pendingError?.(new Error('Paired connection identity is incomplete.'))
        socket.close(1008, 'paired_identity_unavailable')
        return
      }
      frame = {
        type: 'relay.attach',
        version: RELAY_PROTOCOL_VERSION,
        nodeId: target.nodeId,
        role: 'client',
        connectionId: attachConnectionId,
        clientToken: target.clientToken,
        trustEpoch: target.trustEpoch,
        deviceId: target.deviceId,
      }
    }
    originalSend(encodeFrame(frame))
  })
  socket.addEventListener('message', (event) => {
    const frame = parseFrame(String(event.data))
    if (!frame) return
    event.stopImmediatePropagation()
    if (frame.type === 'relay.ready') {
      if (frame.role !== 'client') return
      connectionId = frame.connectionId
      relayNodeId = frame.nodeId
      relayTrustEpoch =
        'trustEpoch' in frame && typeof frame.trustEpoch === 'number' ? frame.trustEpoch : null
      relayOwnerPublicKey =
        'ownerPublicKey' in frame && typeof frame.ownerPublicKey === 'string'
          ? frame.ownerPublicKey
          : null
      void startHandshake()
      return
    }
    if (frame.type === 'relay.client.connected') {
      // Older test relays may notify the client explicitly. The real relay sends relay.ready to
      // the client and relay.client.connected only to the Owner, so keep this as a compatibility
      // fallback without allowing a duplicate handshake.
      connectionId = frame.connectionId
      if (!target.nodeId) relayNodeId = frame.nodeId
      void startHandshake()
      return
    }
    if (frame.type !== 'relay.forward' || frame.connectionId !== connectionId) return
    const payload = parseFrame(frame.payload)
    if (!payload) return
    if (!key || !isEncryptedFrame(payload) || payload.sequence !== receiveSequence + 1) return
    receiveSequence = payload.sequence
    void decryptPayload(key, payload)
      .then((value) => {
        const handshake = parseFrame(value)
        if (handshake?.type === 'handshake.ok') {
          if (
            handshake.nodeId !== (target.nodeId ?? relayNodeId ?? handshake.nodeId) ||
            (target.trustEpoch !== undefined && handshake.trustEpoch !== target.trustEpoch) ||
            handshake.clientPublicKey !== target.publicKey
          )
            throw new Error('Owner identity does not match the selected target.')
          if (
            target.expectedOwnerPublicKey &&
            target.expectedOwnerPublicKey !== handshake.ownerPublicKey
          )
            throw new Error('Owner identity does not match the saved connection.')
          pendingOpen?.()
          pendingOpen = null
          for (const queuedValue of queued.splice(0)) socket.send(queuedValue)
          return undefined
        }
        if (handshake?.type === 'connection.close') {
          socket.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                type: 'close',
                code: handshake.code,
                ...(handshake.message ? { message: handshake.message } : {}),
              }),
            }),
          )
          socket.close(1000, handshake.code)
          return undefined
        }
        socket.dispatchEvent(new MessageEvent('message', { data: value }))
        return undefined
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error('Relay handshake failed')
        pendingError?.(failure)
        socket.close(1008, 'owner_handshake_failed')
        return undefined
      })
  })
  socket.addEventListener('error', () => pendingError?.(new Error('Relay connection failed')))
  ;(socket as WebSocket & { waitForHandshake?: () => Promise<void> }).waitForHandshake = () =>
    new Promise((resolve, reject) => {
      pendingOpen = resolve
      pendingError = reject
    })
  return socket

  async function startHandshake() {
    if (handshakeStarted) return
    handshakeStarted = true
    const handshakeNodeId = target.nodeId ?? relayNodeId
    const handshakeTrustEpoch = target.trustEpoch ?? relayTrustEpoch
    const ownerPublicKey = relayOwnerPublicKey
    if (!handshakeNodeId || handshakeTrustEpoch === null || handshakeTrustEpoch === undefined) {
      pendingError?.(new Error('Relay did not provide the Owner trust identity.'))
      socket.close(1008, 'owner_identity_unavailable')
      return
    }
    if (!ownerPublicKey) {
      pendingError?.(new Error('Relay did not provide the Owner public key.'))
      socket.close(1008, 'owner_identity_unavailable')
      return
    }
    try {
      if (target.expectedOwnerPublicKey && target.expectedOwnerPublicKey !== ownerPublicKey)
        throw new Error('Owner identity does not match the saved connection.')
      const ownerKey = await importPublicKey(ownerPublicKey)
      key = (await deriveSessionKey(
        target.privateKey,
        ownerKey,
        `codex-web-relay/v1/${handshakeNodeId}/${handshakeTrustEpoch}/${ownerPublicKey}/${target.publicKey}`,
      )) as unknown as CryptoKey
      originalSend(
        encodeFrame({
          type: 'relay.forward',
          version: RELAY_PROTOCOL_VERSION,
          connectionId: connectionId!,
          payload: encodeFrame({
            type: 'handshake',
            version: RELAY_PROTOCOL_VERSION,
            nodeId: handshakeNodeId,
            clientPublicKey: target.publicKey,
            trustEpoch: handshakeTrustEpoch,
          }),
        }),
      )
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Relay handshake failed')
      pendingError?.(failure)
      socket.close(1008, 'owner_handshake_failed')
    }
  }
}
