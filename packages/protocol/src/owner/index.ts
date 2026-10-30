export const OWNER_PROTOCOL_VERSION = 1 as const
export const OWNER_MAX_FRAME_BYTES = 1024 * 1024

export const OWNER_CAPABILITIES = [
  'owner',
  'credentials',
  'projects',
  'codex',
  'configuration',
  'skills',
  'threads',
  'turns',
  'approvals',
  'events',
  'remote-administration',
] as const

export type OwnerCapability = (typeof OWNER_CAPABILITIES)[number]

export const OWNER_ERROR_CODES = [
  'INVALID_JSON',
  'INVALID_FRAME',
  'UNSUPPORTED_FRAME',
  'UNSUPPORTED_VERSION',
  'FRAME_TOO_LARGE',
  'NON_TEXT_FRAME',
  'INVALID_HELLO',
  'HELLO_REQUIRED',
  'HELLO_ALREADY_RECEIVED',
  'UNAUTHORIZED',
  'LOCAL_TRANSPORT_REQUIRED',
  'WEBAUTHN_ORIGIN_NOT_ALLOWED',
  'PASSKEY_INVALID',
  'PASSKEY_REQUIRED',
  'ENROLLMENT_TICKET_REQUIRED',
  'ENROLLMENT_TICKET_INVALID',
  'CHALLENGE_EXPIRED',
  'DUPLICATE_REQUEST_ID',
  'REQUEST_LIMIT_EXCEEDED',
  'REQUEST_TIMEOUT',
  'REQUEST_CANCELLED',
  'METHOD_NOT_FOUND',
  'INVALID_PARAMS',
  'INTERNAL_ERROR',
  'BACKPRESSURE_LIMIT_EXCEEDED',
  'SUBSCRIPTION_EXPIRED',
  'INVALID_EVENT_CURSOR',
  'OWNER_ALREADY_EXISTS',
  'INVALID_CREDENTIAL',
  'CREDENTIAL_NOT_FOUND',
  'PROJECT_NOT_FOUND',
  'PROJECT_EXISTS',
  'THREAD_NOT_FOUND',
  'INVALID_THREAD',
  'INVALID_THREAD_QUERY',
  'CODEX_START_REQUIRED',
  'CODEX_PROTOCOL_ERROR',
  'INVALID_TURN_REQUEST',
  'AUTH_FAILURE',
  'CODEX_UNAVAILABLE',
  'RESOURCE_NOT_FOUND',
  'REMOTE_UNAVAILABLE',
  'REMOTE_RELAY_REQUIRED',
  'DEVICE_NOT_FOUND',
  'FIRST_SESSION_ALREADY_USED',
  'FIRST_SESSION_GRANT_INVALID',
] as const

export type OwnerErrorCode = (typeof OWNER_ERROR_CODES)[number]

export type OwnerError = {
  code: OwnerErrorCode | (string & {})
  message: string
  retryable: boolean
}

export type OwnerHelloFrame = {
  type: 'hello'
  version: number
  clientId: string
  capabilities: string[]
  sessionToken?: string
}

export type OwnerReadyFrame = {
  type: 'ready'
  version: typeof OWNER_PROTOCOL_VERSION
  connectionId: string
  authenticated: boolean
  capabilities: string[]
}

export type OwnerRequestFrame = {
  type: 'request'
  requestId: string
  method: string
  params?: unknown
}

export type OwnerResponseFrame = {
  type: 'response'
  requestId: string
  result?: unknown
  error?: OwnerError
}

export type OwnerNotificationFrame = {
  type: 'notification'
  method: string
  params?: unknown
}

export type OwnerStreamOpenFrame = {
  type: 'stream.open'
  streamId: string
  requestId: string
  meta?: unknown
}

export type OwnerStreamEventFrame = {
  type: 'stream.event'
  streamId: string
  event: unknown
}

export type OwnerStreamCloseFrame = {
  type: 'stream.close'
  streamId: string
  reason?: string
}

export type OwnerCancelFrame = {
  type: 'cancel'
  requestId?: string
  streamId?: string
}

export type OwnerCloseFrame = {
  type: 'close'
  code: string
  message?: string
}

export type OwnerFrame =
  | OwnerHelloFrame
  | OwnerReadyFrame
  | OwnerRequestFrame
  | OwnerResponseFrame
  | OwnerNotificationFrame
  | OwnerStreamOpenFrame
  | OwnerStreamEventFrame
  | OwnerStreamCloseFrame
  | OwnerCancelFrame
  | OwnerCloseFrame

export type OwnerProtocolIssue = {
  code: OwnerErrorCode
  message: string
}

export type OwnerParseResult =
  | { ok: true; frame: OwnerFrame }
  | { ok: false; error: OwnerProtocolIssue }

const MAX_ID_LENGTH = 128
const MAX_METHOD_LENGTH = 128
const MAX_LABEL_LENGTH = 128
const MAX_CAPABILITIES = 64
const MAX_JSON_NODES = 100_000
const MAX_JSON_DEPTH = 128

export function parseOwnerFrame(input: unknown): OwnerParseResult {
  if (input instanceof Uint8Array)
    return failure('NON_TEXT_FRAME', 'Owner protocol accepts UTF-8 JSON text frames only.')
  if (typeof input !== 'string') return failure('INVALID_FRAME', 'Frame must be a JSON string.')
  if (byteLength(input) > OWNER_MAX_FRAME_BYTES)
    return failure('FRAME_TOO_LARGE', 'Frame exceeds the maximum size.')

  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return failure('INVALID_JSON', 'Frame is not valid JSON.')
  }

  if (!isRecord(value) || typeof value.type !== 'string')
    return failure('INVALID_FRAME', 'Frame must be an object with a type.')
  if (!isSupportedFrameType(value.type))
    return failure('UNSUPPORTED_FRAME', 'Frame type is not supported.')

  const issue = validateFrame(value)
  if (issue) return { ok: false, error: issue }
  // Runtime validation above checks the complete discriminated frame shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { ok: true, frame: value as OwnerFrame }
}

export function encodeOwnerFrame(frame: OwnerFrame): string {
  let encoded: string
  try {
    encoded = JSON.stringify(frame)
  } catch {
    throw new TypeError('Owner frame could not be encoded as JSON.')
  }
  if (typeof encoded !== 'string') throw new TypeError('Owner frame could not be encoded as JSON.')
  const parsed = parseOwnerFrame(encoded)
  if (!parsed.ok) throw new TypeError(parsed.error.message)
  return encoded
}

function validateFrame(value: Record<string, unknown>): OwnerProtocolIssue | null {
  switch (value.type) {
    case 'hello':
      if (!hasOnlyKeys(value, ['type', 'version', 'clientId', 'capabilities', 'sessionToken']))
        return failureValue('INVALID_HELLO', 'Hello frame contains unsupported fields.')
      if (!isSafeVersion(value.version))
        return failureValue('UNSUPPORTED_VERSION', 'Protocol version is not supported.')
      if (!isIdentifier(value.clientId))
        return failureValue('INVALID_HELLO', 'Hello clientId is invalid.')
      if (!isCapabilities(value.capabilities))
        return failureValue('INVALID_HELLO', 'Hello capabilities are invalid.')
      if ('sessionToken' in value && !isBoundedString(value.sessionToken, 4096))
        return failureValue('INVALID_HELLO', 'Hello sessionToken is invalid.')
      return null
    case 'ready':
      if (
        !hasOnlyKeys(value, ['type', 'version', 'connectionId', 'authenticated', 'capabilities']) ||
        value.version !== OWNER_PROTOCOL_VERSION ||
        !isIdentifier(value.connectionId) ||
        typeof value.authenticated !== 'boolean' ||
        !isCapabilities(value.capabilities)
      )
        return failureValue('INVALID_FRAME', 'Ready frame is invalid.')
      return null
    case 'request':
      if (
        !hasOnlyKeys(value, ['type', 'requestId', 'method', 'params']) ||
        !isIdentifier(value.requestId) ||
        !isBoundedString(value.method, MAX_METHOD_LENGTH) ||
        ('params' in value && !isJsonValue(value.params))
      )
        return failureValue('INVALID_FRAME', 'Request frame is invalid.')
      return null
    case 'response': {
      const hasResult = 'result' in value
      const hasError = 'error' in value
      if (
        !hasOnlyKeys(value, ['type', 'requestId', 'result', 'error']) ||
        !isIdentifier(value.requestId) ||
        hasResult === hasError ||
        (hasResult && !isJsonValue(value.result)) ||
        (hasError && !isOwnerError(value.error))
      )
        return failureValue('INVALID_FRAME', 'Response frame is invalid.')
      return null
    }
    case 'notification':
      if (
        !hasOnlyKeys(value, ['type', 'method', 'params']) ||
        !isBoundedString(value.method, MAX_METHOD_LENGTH) ||
        ('params' in value && !isJsonValue(value.params))
      )
        return failureValue('INVALID_FRAME', 'Notification frame is invalid.')
      return null
    case 'stream.open':
      if (
        !hasOnlyKeys(value, ['type', 'streamId', 'requestId', 'meta']) ||
        !isIdentifier(value.streamId) ||
        !isIdentifier(value.requestId) ||
        ('meta' in value && !isJsonValue(value.meta))
      )
        return failureValue('INVALID_FRAME', 'Stream open frame is invalid.')
      return null
    case 'stream.event':
      if (
        !hasOnlyKeys(value, ['type', 'streamId', 'event']) ||
        !isIdentifier(value.streamId) ||
        !('event' in value) ||
        !isJsonValue(value.event)
      )
        return failureValue('INVALID_FRAME', 'Stream event frame is invalid.')
      return null
    case 'stream.close':
      if (
        !hasOnlyKeys(value, ['type', 'streamId', 'reason']) ||
        !isIdentifier(value.streamId) ||
        ('reason' in value && !isBoundedString(value.reason, MAX_LABEL_LENGTH))
      )
        return failureValue('INVALID_FRAME', 'Stream close frame is invalid.')
      return null
    case 'cancel': {
      const hasRequest = 'requestId' in value
      const hasStream = 'streamId' in value
      if (
        !hasOnlyKeys(value, ['type', 'requestId', 'streamId']) ||
        hasRequest === hasStream ||
        (hasRequest && !isIdentifier(value.requestId)) ||
        (hasStream && !isIdentifier(value.streamId))
      )
        return failureValue('INVALID_FRAME', 'Cancel frame must target one request or stream.')
      return null
    }
    case 'close':
      if (
        !hasOnlyKeys(value, ['type', 'code', 'message']) ||
        !isBoundedString(value.code, MAX_LABEL_LENGTH) ||
        ('message' in value && !isBoundedString(value.message, MAX_LABEL_LENGTH))
      )
        return failureValue('INVALID_FRAME', 'Close frame is invalid.')
      return null
    default:
      return failureValue('UNSUPPORTED_FRAME', 'Frame type is not supported.')
  }
}

function isJsonValue(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let visited = 0

  while (pending.length > 0) {
    const current = pending.pop()!
    visited += 1
    if (visited > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) return false
    if (
      current.value === null ||
      typeof current.value === 'string' ||
      typeof current.value === 'boolean' ||
      (typeof current.value === 'number' && Number.isFinite(current.value))
    )
      continue
    if (Array.isArray(current.value)) {
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 })
      continue
    }
    if (isRecord(current.value)) {
      for (const item of Object.values(current.value))
        pending.push({ value: item, depth: current.depth + 1 })
      continue
    }
    return false
  }
  return true
}

function isOwnerError(value: unknown): value is OwnerError {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['code', 'message', 'retryable']) &&
    isBoundedString(value.code, MAX_LABEL_LENGTH) &&
    isBoundedString(value.message, 2048) &&
    typeof value.retryable === 'boolean'
  )
}

function isCapabilities(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CAPABILITIES &&
    value.every((item) => isBoundedString(item, MAX_LABEL_LENGTH)) &&
    new Set(value).size === value.length
  )
}

function isIdentifier(value: unknown): value is string {
  return isBoundedString(value, MAX_ID_LENGTH) && value.trim().length > 0
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isSafeVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && value === OWNER_PROTOCOL_VERSION
}

function isSupportedFrameType(value: string): value is OwnerFrame['type'] {
  return (
    value === 'hello' ||
    value === 'ready' ||
    value === 'request' ||
    value === 'response' ||
    value === 'notification' ||
    value === 'stream.open' ||
    value === 'stream.event' ||
    value === 'stream.close' ||
    value === 'cancel' ||
    value === 'close'
  )
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function failure(code: OwnerErrorCode, message: string): OwnerParseResult {
  return { ok: false, error: { code, message } }
}

function failureValue(code: OwnerErrorCode, message: string): OwnerProtocolIssue {
  return { code, message }
}
