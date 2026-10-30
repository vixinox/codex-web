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
  loginOwnerCode?: string
  firstSessionOwnerCode?: string
  firstSessionGrant?: string
  bootstrapReference?: string
  /** For an explicitly confirmed bootstrap, the QR payload carries the key fingerprint. */
  firstSessionFingerprint?: string
  expectedOwnerFingerprint?: string
  onOwnerFingerprint?: (fingerprint: string) => void
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
    })
  }) as typeof socket.send

  socket.addEventListener('open', () => {
    const frame = {
      type: 'relay.attach' as const,
      version: RELAY_PROTOCOL_VERSION,
      nodeId: target.nodeId,
      role: 'client' as const,
      connectionId: crypto.randomUUID(),
      ...(target.bootstrapReference
        ? {
            admission: 'bootstrap_reference' as const,
            reference: target.bootstrapReference,
          }
        : target.firstSessionOwnerCode && target.firstSessionGrant
          ? {
              admission: 'first_session' as const,
              ownerCode: target.firstSessionOwnerCode,
              grant: target.firstSessionGrant,
            }
          : target.loginOwnerCode
            ? { admission: 'login' as const, ownerCode: target.loginOwnerCode }
            : {
                clientToken: target.clientToken,
                trustEpoch: target.trustEpoch,
                deviceId: target.deviceId!,
              }),
    } as RelayAttachFrame
    originalSend(encodeFrame(frame))
  })
  socket.addEventListener('message', (event) => {
    const frame = parseFrame(String(event.data))
    if (!frame) return
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
          return fingerprint(handshake.ownerPublicKey).then((actual) => {
            target.onOwnerFingerprint?.(actual)
            if (
              target.firstSessionOwnerCode &&
              target.firstSessionFingerprint !== handshake.ownerPublicKey
            )
              throw new Error('Owner fingerprint does not match the first-session grant.')
            if (target.expectedOwnerFingerprint && actual !== target.expectedOwnerFingerprint)
              throw new Error('Owner fingerprint mismatch. Verify the Owner before signing in.')
            pendingOpen?.()
            pendingOpen = null
            for (const queuedValue of queued.splice(0)) socket.send(queuedValue)
          })
        }
        socket.dispatchEvent(new MessageEvent('message', { data: value }))
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error('Relay handshake failed')
        pendingError?.(failure)
        socket.close(1008, 'owner_handshake_failed')
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
      const actual = await fingerprint(ownerPublicKey)
      target.onOwnerFingerprint?.(actual)
      if (target.expectedOwnerFingerprint && actual !== target.expectedOwnerFingerprint)
        throw new Error('Owner fingerprint mismatch. Verify the Owner before signing in.')
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

async function fingerprint(serializedPublicKey: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serializedPublicKey),
  )
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
    .slice(0, 16)
}
