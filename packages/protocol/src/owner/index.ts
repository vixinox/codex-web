import { isPublicErrorDto, type PublicErrorDto } from '@codex-web/telemetry/errors'

export const DOMAIN_EVENT_RUNTIME = 'codex' as const
export const MAX_DOMAIN_EVENT_PAYLOAD_BYTES = 128_000
export const OWNER_MAX_FRAME_BYTES = 1024 * 1024

export type DomainEventEnvelope = {
  eventId: number
  type: string
  runtime: typeof DOMAIN_EVENT_RUNTIME
  threadId?: string
  turnId?: string
  itemId?: string
  requestId?: number | string
  createdAt: string
  payload: Record<string, unknown>
}

export type DomainEventInput = Omit<DomainEventEnvelope, 'eventId'> & { eventId?: number }

export type OwnerEventCursor = { epoch: string; sequence: number }

export type OwnerStreamEvent = {
  cursor: OwnerEventCursor
  event: DomainEventEnvelope
}

export type OwnerResetStreamEvent = {
  method: 'events.reset'
  params: { cursor: OwnerEventCursor; reason?: string }
}

export type OwnerEventStreamMessage = OwnerStreamEvent | OwnerResetStreamEvent

export type DomainEventParseErrorCode = 'INVALID_EVENT_ENVELOPE'

export type OwnerEventParseIssueCode = DomainEventParseErrorCode
export type OwnerEventParseIssue = { code: OwnerEventParseIssueCode; message: string }
export type OwnerStreamParseIssueCode =
  | OwnerEventParseIssueCode
  | 'EVENT_CURSOR_MISMATCH'
  | 'INVALID_STREAM_EVENT'
export type OwnerStreamParseIssue = { code: OwnerStreamParseIssueCode; message: string }

export type DomainEventParseResult =
  | { ok: true; event: DomainEventEnvelope }
  | { ok: false; error: OwnerEventParseIssue }

export type OwnerStreamEventParseResult =
  | { ok: true; value: OwnerStreamEvent }
  | {
      ok: false
      error: OwnerStreamParseIssue
    }

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

export type OwnerHelloFrame = {
  type: 'hello'
  clientId: string
  capabilities: string[]
  sessionToken?: string
}

export type OwnerReadyFrame = {
  type: 'ready'
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
  error?: PublicErrorDto
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

export type OwnerProtocolIssueCode =
  | 'INVALID_JSON'
  | 'INVALID_FRAME'
  | 'UNSUPPORTED_FRAME'
  | 'FRAME_TOO_LARGE'
  | 'NON_TEXT_FRAME'
  | 'INVALID_HELLO'
  | 'INVALID_EVENT_ENVELOPE'
  | 'EVENT_CURSOR_MISMATCH'
  | 'EVENT_IDENTITY_MISMATCH'
  | 'INVALID_STREAM_EVENT'

export type OwnerProtocolIssue = {
  code: OwnerProtocolIssueCode
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
const MAX_EVENT_TYPE_LENGTH = 256

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
  if (value.type === 'stream.event') {
    const parsedEvent = parseOwnerEventStreamMessage(value.event)
    if (!parsedEvent.ok) return failure(parsedEvent.error.code, parsedEvent.error.message)
  }

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

export function parseOwnerEventCursor(value: unknown): OwnerEventCursor | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['epoch', 'sequence']) ||
    !isIdentifier(value.epoch) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0
  )
    return null
  return { epoch: value.epoch, sequence: value.sequence as number }
}

export function parseDomainEventEnvelope(value: unknown): DomainEventParseResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'eventId',
      'type',
      'runtime',
      'threadId',
      'turnId',
      'itemId',
      'requestId',
      'createdAt',
      'payload',
    ]) ||
    !Number.isSafeInteger(value.eventId) ||
    (value.eventId as number) < 1 ||
    !isBoundedString(value.type, MAX_EVENT_TYPE_LENGTH) ||
    value.runtime !== DOMAIN_EVENT_RUNTIME ||
    !isIsoDateTime(value.createdAt) ||
    !isRecord(value.payload) ||
    !isJsonValue(value.payload) ||
    byteLength(JSON.stringify(value.payload)) > MAX_DOMAIN_EVENT_PAYLOAD_BYTES ||
    !optionalIdentifier(value.threadId) ||
    !optionalIdentifier(value.turnId) ||
    !optionalIdentifier(value.itemId) ||
    !optionalRequestId(value.requestId)
  )
    return {
      ok: false,
      error: {
        code: 'INVALID_EVENT_ENVELOPE',
        message: 'Owner event envelope is invalid.',
      },
    }

  // The runtime checks above validate every field and the full JSON payload.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { ok: true, event: value as DomainEventEnvelope }
}

export function parseOwnerStreamEvent(value: unknown): OwnerStreamEventParseResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ['cursor', 'event']) || !('event' in value))
    return {
      ok: false,
      error: { code: 'INVALID_STREAM_EVENT', message: 'Owner stream event is invalid.' },
    }

  const cursor = parseOwnerEventCursor(value.cursor)
  if (!cursor)
    return {
      ok: false,
      error: { code: 'INVALID_STREAM_EVENT', message: 'Owner stream cursor is invalid.' },
    }

  const parsedEvent = parseDomainEventEnvelope(value.event)
  if (!parsedEvent.ok) return parsedEvent
  if (parsedEvent.event.eventId !== cursor.sequence)
    return {
      ok: false,
      error: {
        code: 'EVENT_CURSOR_MISMATCH',
        message: 'Owner event cursor does not match its event identity.',
      },
    }
  return { ok: true, value: { cursor, event: parsedEvent.event } }
}

export function parseOwnerEventStreamMessage(
  value: unknown,
): { ok: true; message: OwnerEventStreamMessage } | { ok: false; error: OwnerStreamParseIssue } {
  if (isRecord(value) && value.method === 'events.reset') {
    const params = value.params
    if (
      !hasOnlyKeys(value, ['method', 'params']) ||
      !isRecord(params) ||
      !hasOnlyKeys(params, ['cursor', 'reason'])
    )
      return {
        ok: false,
        error: { code: 'INVALID_STREAM_EVENT', message: 'Owner reset event is invalid.' },
      }
    const cursor = parseOwnerEventCursor(params.cursor)
    if (
      !cursor ||
      (params.reason !== undefined && !isBoundedString(params.reason, MAX_LABEL_LENGTH))
    )
      return {
        ok: false,
        error: { code: 'INVALID_STREAM_EVENT', message: 'Owner reset event is invalid.' },
      }
    return {
      ok: true,
      message: {
        method: 'events.reset',
        params: { cursor, ...(typeof params.reason === 'string' ? { reason: params.reason } : {}) },
      },
    }
  }
  const parsed = parseOwnerStreamEvent(value)
  return parsed.ok ? { ok: true, message: parsed.value } : parsed
}

function validateFrame(value: Record<string, unknown>): OwnerProtocolIssue | null {
  switch (value.type) {
    case 'hello':
      if (!hasOnlyKeys(value, ['type', 'clientId', 'capabilities', 'sessionToken']))
        return failureValue('INVALID_HELLO', 'Hello frame contains unsupported fields.')
      if (!isIdentifier(value.clientId))
        return failureValue('INVALID_HELLO', 'Hello clientId is invalid.')
      if (!isCapabilities(value.capabilities))
        return failureValue('INVALID_HELLO', 'Hello capabilities are invalid.')
      if ('sessionToken' in value && !isBoundedString(value.sessionToken, 4096))
        return failureValue('INVALID_HELLO', 'Hello sessionToken is invalid.')
      return null
    case 'ready':
      if (
        !hasOnlyKeys(value, ['type', 'connectionId', 'authenticated', 'capabilities']) ||
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
        (hasError && !isOwnerPublicError(value.error))
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

function isOwnerPublicError(value: unknown): value is PublicErrorDto {
  return isPublicErrorDto(value) && value.code.startsWith('owner.')
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

function isIsoDateTime(value: unknown): value is string {
  return (
    isBoundedString(value, 64) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function optionalIdentifier(value: unknown) {
  return value === undefined || isIdentifier(value)
}

function optionalRequestId(value: unknown) {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH)
  )
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

function failure(code: OwnerProtocolIssueCode, message: string): OwnerParseResult {
  return { ok: false, error: { code, message } }
}

function failureValue(code: OwnerProtocolIssueCode, message: string): OwnerProtocolIssue {
  return { code, message }
}

export function isOwnerEventErrorCode(code: unknown): code is OwnerStreamParseIssueCode {
  return (
    typeof code === 'string' &&
    [
      'INVALID_EVENT_ENVELOPE',
      'EVENT_CURSOR_MISMATCH',
      'EVENT_IDENTITY_MISMATCH',
      'INVALID_STREAM_EVENT',
    ].includes(code)
  )
}
