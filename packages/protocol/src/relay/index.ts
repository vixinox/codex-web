export const RELAY_PROTOCOL_VERSION = 1 as const

export type ConnectionRole = 'owner' | 'client'

export type RelayAttachFrame = {
  type: 'relay.attach'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  role: ConnectionRole
  connectionId: string
}

export type RelayReadyFrame = {
  type: 'relay.ready'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  role: ConnectionRole
  connectionId: string
}

export type RelayClientConnectedFrame = {
  type: 'relay.client.connected'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  connectionId: string
}

export type RelayClientDisconnectedFrame = {
  type: 'relay.client.disconnected'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  connectionId: string
}

export type RelayForwardFrame = {
  type: 'relay.forward'
  version: typeof RELAY_PROTOCOL_VERSION
  connectionId: string
  payload: string
}

export type PairingOfferFrame = {
  type: 'pairing.offer'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  ownerPublicKey: string
  challenge: string
  expiresAt: string
  trustEpoch: number
}

export type PairingAcceptFrame = {
  type: 'pairing.accept'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  challenge: string
  clientPublicKey: string
}

export type HandshakeFrame = {
  type: 'handshake'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  clientPublicKey: string
  trustEpoch: number
}

export type PairingResultFrame = {
  type: 'pairing.result'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  accepted: boolean
  trustEpoch: number
  ownerPublicKey: string
}

export type EncryptedFrame = {
  type: 'encrypted'
  version: typeof RELAY_PROTOCOL_VERSION
  sequence: number
  iv: string
  ciphertext: string
}

export type ConnectionCloseFrame = {
  type: 'connection.close'
  version: typeof RELAY_PROTOCOL_VERSION
  code: string
  message?: string
}

export type RelayFrame =
  | RelayAttachFrame
  | RelayReadyFrame
  | RelayClientConnectedFrame
  | RelayClientDisconnectedFrame
  | RelayForwardFrame
  | PairingOfferFrame
  | PairingAcceptFrame
  | PairingResultFrame
  | HandshakeFrame
  | EncryptedFrame
  | ConnectionCloseFrame

const frameTypes = new Set<RelayFrame['type']>([
  'relay.attach',
  'relay.ready',
  'relay.client.connected',
  'relay.client.disconnected',
  'relay.forward',
  'pairing.offer',
  'pairing.accept',
  'pairing.result',
  'handshake',
  'encrypted',
  'connection.close',
])

export function encodeFrame(frame: RelayFrame): string {
  return JSON.stringify(frame)
}

export function parseFrame(value: string): RelayFrame | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || parsed.version !== RELAY_PROTOCOL_VERSION) return null
    if (typeof parsed.type !== 'string' || !frameTypes.has(parsed.type as RelayFrame['type']))
      return null
    return parsed as RelayFrame
  } catch {
    return null
  }
}

export function isRelayAttachFrame(frame: RelayFrame | null): frame is RelayAttachFrame {
  return Boolean(
    frame &&
    frame.type === 'relay.attach' &&
    frame.version === RELAY_PROTOCOL_VERSION &&
    typeof frame.nodeId === 'string' &&
    frame.nodeId.length > 0 &&
    (frame.role === 'owner' || frame.role === 'client') &&
    typeof frame.connectionId === 'string' &&
    frame.connectionId.length > 0,
  )
}

export function isPairingAcceptFrame(frame: RelayFrame | null): frame is PairingAcceptFrame {
  return Boolean(
    frame &&
    frame.type === 'pairing.accept' &&
    frame.version === RELAY_PROTOCOL_VERSION &&
    typeof frame.nodeId === 'string' &&
    typeof frame.challenge === 'string' &&
    typeof frame.clientPublicKey === 'string',
  )
}

export function isHandshakeFrame(frame: RelayFrame | null): frame is HandshakeFrame {
  return Boolean(
    frame &&
    frame.type === 'handshake' &&
    frame.version === RELAY_PROTOCOL_VERSION &&
    typeof frame.nodeId === 'string' &&
    typeof frame.clientPublicKey === 'string' &&
    Number.isSafeInteger(frame.trustEpoch),
  )
}

export function isEncryptedFrame(frame: RelayFrame | null): frame is EncryptedFrame {
  return Boolean(
    frame &&
    frame.type === 'encrypted' &&
    frame.version === RELAY_PROTOCOL_VERSION &&
    Number.isSafeInteger(frame.sequence) &&
    frame.sequence > 0 &&
    typeof frame.iv === 'string' &&
    typeof frame.ciphertext === 'string',
  )
}

export function isRelayForwardFrame(frame: RelayFrame | null): frame is RelayForwardFrame {
  return Boolean(
    frame &&
    frame.type === 'relay.forward' &&
    typeof frame.connectionId === 'string' &&
    typeof frame.payload === 'string',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
