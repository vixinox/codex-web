import { deriveSessionKey, decryptPayload, encryptPayload, importPublicKey } from './relay-crypto'
import {
  encodeFrame,
  isEncryptedFrame,
  parseFrame,
  RELAY_PROTOCOL_VERSION,
} from '@codex-web/protocol/relay'
import type { RelayAttachFrame } from '@codex-web/protocol/relay'

export type RelayTarget = {
  nodeId: string
  trustEpoch: number
  clientToken: string
  deviceId?: string
  publicKey: string
  privateKey: CryptoKey
  loginOwnerCode?: string
  expectedOwnerFingerprint?: string
  onOwnerFingerprint?: (fingerprint: string) => void
}

export function createRelayOwnerSocket(url: string, target: RelayTarget): WebSocket {
  const socket = new WebSocket(url)
  let connectionId: string | null = null
  let key: CryptoKey | null = null
  let sendSequence = 0
  let receiveSequence = 0
  let pendingOpen: (() => void) | null = null
  let pendingError: ((error: Error) => void) | null = null
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
      ...(target.loginOwnerCode
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
    if (frame.type === 'relay.client.connected') {
      connectionId = frame.connectionId
      originalSend(
        encodeFrame({
          type: 'relay.forward',
          version: RELAY_PROTOCOL_VERSION,
          connectionId,
          payload: encodeFrame({
            type: 'handshake',
            version: RELAY_PROTOCOL_VERSION,
            nodeId: target.nodeId,
            clientPublicKey: target.publicKey,
            trustEpoch: target.trustEpoch,
          }),
        }),
      )
      return
    }
    if (frame.type !== 'relay.forward' || frame.connectionId !== connectionId) return
    const payload = parseFrame(frame.payload)
    if (!payload) return
    if (payload.type === 'handshake.ok') {
      if (
        payload.nodeId !== target.nodeId ||
        payload.trustEpoch !== target.trustEpoch ||
        payload.clientPublicKey !== target.publicKey
      ) {
        pendingError?.(new Error('Owner identity does not match the selected target.'))
        socket.close(1008, 'owner_identity_mismatch')
        return
      }
      void fingerprint(payload.ownerPublicKey)
        .then((actual) => {
          target.onOwnerFingerprint?.(actual)
          if (target.loginOwnerCode && !target.expectedOwnerFingerprint)
            throw new Error('Verify the Owner fingerprint before signing in.')
          if (target.expectedOwnerFingerprint && actual !== target.expectedOwnerFingerprint)
            throw new Error('Owner fingerprint mismatch. Verify the Owner before signing in.')
        })
        .then(() => importPublicKey(payload.ownerPublicKey))
        .then((ownerKey) =>
          deriveSessionKey(
            target.privateKey,
            ownerKey as unknown as CryptoKey,
            `codex-web-relay/v1/${target.nodeId}/${target.trustEpoch}/${payload.ownerPublicKey}/${target.publicKey}`,
          ),
        )
        .then((nextKey) => {
          key = nextKey as unknown as CryptoKey
          pendingOpen?.()
          pendingOpen = null
          for (const value of queued.splice(0)) socket.send(value)
        })
        .catch((error: unknown) => {
          const failure = error instanceof Error ? error : new Error('Relay handshake failed')
          pendingError?.(failure)
          socket.close(1008, 'owner_handshake_failed')
        })
      return
    }
    if (!key || !isEncryptedFrame(payload) || payload.sequence !== receiveSequence + 1) return
    receiveSequence = payload.sequence
    void decryptPayload(key, payload).then((value) =>
      socket.dispatchEvent(new MessageEvent('message', { data: value })),
    )
  })
  socket.addEventListener('error', () => pendingError?.(new Error('Relay connection failed')))
  ;(socket as WebSocket & { waitForHandshake?: () => Promise<void> }).waitForHandshake = () =>
    new Promise((resolve, reject) => {
      pendingOpen = resolve
      pendingError = reject
    })
  return socket
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
