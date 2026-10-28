export const RELAY_PROTOCOL_VERSION = 1 as const

export type ConnectionRole = 'owner' | 'client'

/** Upper bound for routing identifiers carried in relay routing frames. */
export const MAX_ROUTE_ID_BYTES = 128

type RelayAttachBase = {
  type: 'relay.attach'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  connectionId: string
}

export type RelayOwnerAttachFrame = RelayAttachBase & {
  role: 'owner'
  ownerCode: string
  ownerToken: string
  trustEpoch: number
  ownerPublicKey: string
}

export type RelayPairedClientAttachFrame = RelayAttachBase & {
  role: 'client'
  clientToken: string
  deviceId: string
  trustEpoch: number
  admission?: undefined
}

export type RelayLoginClientAttachFrame = {
  type: 'relay.attach'
  version: typeof RELAY_PROTOCOL_VERSION
  role: 'client'
  admission: 'login'
  connectionId: string
  ownerCode: string
}

export type RelayAttachFrame =
  | RelayOwnerAttachFrame
  | RelayPairedClientAttachFrame
  | RelayLoginClientAttachFrame

export type RelayReadyFrame = {
  type: 'relay.ready'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  role: ConnectionRole
  connectionId: string
}

type RelayClientConnectedBase = {
  type: 'relay.client.connected'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  connectionId: string
}

export type RelayPairedClientConnectedFrame = RelayClientConnectedBase & {
  deviceId: string
  admission?: undefined
}

export type RelayLoginClientConnectedFrame = RelayClientConnectedBase & {
  admission: 'login'
  ownerCode: string
  deviceId?: never
}

export type RelayClientConnectedFrame =
  | RelayPairedClientConnectedFrame
  | RelayLoginClientConnectedFrame

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

export type HandshakeFrame = {
  type: 'handshake'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  clientPublicKey: string
  trustEpoch: number
}

/**
 * Owner's key-confirmation reply to `handshake`. It is sent through the session key as the first
 * encrypted record, so a client that decrypts it has proof the Owner derived the same context.
 */
export type HandshakeOkFrame = {
  type: 'handshake.ok'
  version: typeof RELAY_PROTOCOL_VERSION
  nodeId: string
  trustEpoch: number
  ownerPublicKey: string
  clientPublicKey: string
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
  | HandshakeFrame
  | HandshakeOkFrame
  | EncryptedFrame
  | ConnectionCloseFrame

const frameTypes = new Set<RelayFrame['type']>([
  'relay.attach',
  'relay.ready',
  'relay.client.connected',
  'relay.client.disconnected',
  'relay.forward',
  'handshake',
  'handshake.ok',
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
  if (
    frame &&
    frame.type === 'relay.attach' &&
    frame.version === RELAY_PROTOCOL_VERSION &&
    frame.role === 'client' &&
    frame.admission === 'login'
  )
    return (
      hasOnlyKeys(frame, ['type', 'version', 'role', 'admission', 'connectionId', 'ownerCode']) &&
      isRouteIdentifier(frame.connectionId) &&
      isOwnerCode(frame.ownerCode)
    )
  if (!frame || frame.type !== 'relay.attach' || frame.version !== RELAY_PROTOCOL_VERSION)
    return false
  if (
    !('nodeId' in frame) ||
    !isRouteIdentifier(frame.nodeId) ||
    !isRouteIdentifier(frame.connectionId) ||
    !Number.isSafeInteger(frame.trustEpoch) ||
    frame.trustEpoch < 0
  )
    return false

  if (frame.role === 'owner')
    return (
      hasOnlyKeys(frame, [
        'type',
        'version',
        'nodeId',
        'role',
        'connectionId',
        'ownerToken',
        'ownerCode',
        'ownerPublicKey',
        'trustEpoch',
      ]) &&
      typeof frame.ownerToken === 'string' &&
      frame.ownerToken.length >= 32 &&
      isOwnerCode(frame.ownerCode) &&
      typeof frame.ownerPublicKey === 'string'
    )

  if (frame.role !== 'client') return false

  return (
    frame.admission === undefined &&
    hasOnlyKeys(frame, [
      'type',
      'version',
      'nodeId',
      'role',
      'connectionId',
      'clientToken',
      'deviceId',
      'trustEpoch',
    ]) &&
    isRouteIdentifier(frame.deviceId) &&
    typeof frame.clientToken === 'string' &&
    frame.clientToken.length > 0
  )
}

export function isOwnerCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{9}$/.test(value)
}

export function isRelayClientConnectedFrame(
  frame: RelayFrame | null,
): frame is RelayClientConnectedFrame {
  if (
    !frame ||
    frame.type !== 'relay.client.connected' ||
    frame.version !== RELAY_PROTOCOL_VERSION ||
    !isRouteIdentifier(frame.nodeId) ||
    !isRouteIdentifier(frame.connectionId)
  )
    return false

  if ('admission' in frame && frame.admission === 'login')
    return (
      hasOnlyKeys(frame, ['type', 'version', 'nodeId', 'connectionId', 'admission', 'ownerCode']) &&
      isOwnerCode(frame.ownerCode)
    )

  return (
    frame.admission === undefined &&
    hasOnlyKeys(frame, ['type', 'version', 'nodeId', 'connectionId', 'deviceId']) &&
    isRouteIdentifier(frame.deviceId)
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

export function isHandshakeOkFrame(frame: RelayFrame | null): frame is HandshakeOkFrame {
  return Boolean(
    frame &&
    frame.type === 'handshake.ok' &&
    frame.version === RELAY_PROTOCOL_VERSION &&
    typeof frame.nodeId === 'string' &&
    typeof frame.ownerPublicKey === 'string' &&
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
    frame.version === RELAY_PROTOCOL_VERSION &&
    typeof frame.connectionId === 'string' &&
    frame.connectionId.length > 0 &&
    frame.connectionId.length <= MAX_ROUTE_ID_BYTES &&
    typeof frame.payload === 'string',
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRouteIdentifier(value: unknown): value is string {
  return isBoundedRouteIdentifier(value, MAX_ROUTE_ID_BYTES)
}

function isBoundedRouteIdentifier(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maxBytes
  )
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}
