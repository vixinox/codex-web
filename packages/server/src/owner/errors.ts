import {
  createPublicError,
  isKnownTelemetryErrorCode,
  type KnownTelemetryErrorCode,
  type PublicErrorDto,
  type PublicErrorParameter,
} from '@codex-web/telemetry/errors'
import { DiagnosticError } from '@codex-web/telemetry/diagnostic-error'

type OwnerPublicErrorCode = Exclude<KnownTelemetryErrorCode, `relay.${string}`>

const LEGACY_OWNER_ERROR_CODES = {
  INVALID_JSON: 'owner.protocol.invalid-frame',
  INVALID_FRAME: 'owner.protocol.invalid-frame',
  UNSUPPORTED_FRAME: 'owner.protocol.invalid-frame',
  FRAME_TOO_LARGE: 'owner.protocol.frame-too-large',
  NON_TEXT_FRAME: 'owner.protocol.text-frame-required',
  INVALID_HELLO: 'owner.protocol.invalid-handshake',
  HELLO_REQUIRED: 'owner.protocol.invalid-handshake',
  HELLO_ALREADY_RECEIVED: 'owner.protocol.invalid-handshake',
  UNAUTHORIZED: 'owner.auth.unauthorized',
  AUTH_FAILURE: 'owner.auth.unauthorized',
  AUTH_UNAVAILABLE: 'owner.auth.unavailable',
  LOCAL_TRANSPORT_REQUIRED: 'owner.auth.local-transport-required',
  WEBAUTHN_ORIGIN_NOT_ALLOWED: 'owner.auth.origin-not-allowed',
  PASSKEY_INVALID: 'owner.auth.passkey-invalid',
  PASSKEY_REQUIRED: 'owner.auth.passkey-required',
  ENROLLMENT_TICKET_REQUIRED: 'owner.enrollment.ticket-invalid',
  ENROLLMENT_TICKET_INVALID: 'owner.enrollment.ticket-invalid',
  CHALLENGE_EXPIRED: 'owner.auth.challenge-expired',
  SESSION_REVOKED: 'owner.auth.session-revoked',
  SESSION_EXPIRED: 'owner.auth.session-expired',
  STEP_UP_REQUIRED: 'owner.auth.step-up-required',
  DUPLICATE_REQUEST_ID: 'owner.request.duplicate-id',
  REQUEST_LIMIT_EXCEEDED: 'owner.request.limit-exceeded',
  REQUEST_TIMEOUT: 'owner.request.timeout',
  REQUEST_CANCELLED: 'owner.request.cancelled',
  METHOD_NOT_FOUND: 'owner.request.method-not-found',
  INVALID_PARAMS: 'owner.request.invalid-params',
  INTERNAL_ERROR: 'owner.internal.unavailable',
  BACKPRESSURE_LIMIT_EXCEEDED: 'owner.stream.backpressure-limit',
  SUBSCRIPTION_EXPIRED: 'owner.events.subscription-expired',
  INVALID_EVENT_CURSOR: 'owner.events.invalid-cursor',
  INVALID_EVENT_ENVELOPE: 'owner.events.invalid-stream',
  INVALID_STREAM_EVENT: 'owner.events.invalid-stream',
  EVENT_CURSOR_MISMATCH: 'owner.events.invalid-stream',
  EVENT_IDENTITY_MISMATCH: 'owner.events.invalid-stream',
  OWNER_ALREADY_EXISTS: 'owner.setup.already-initialized',
  INVALID_CREDENTIAL: 'owner.credential.invalid',
  CREDENTIAL_NOT_FOUND: 'owner.credential.not-found',
  PROJECT_NOT_FOUND: 'owner.project.not-found',
  PROJECT_EXISTS: 'owner.project.already-exists',
  THREAD_NOT_FOUND: 'owner.thread.not-found',
  INVALID_THREAD: 'owner.thread.invalid-id',
  INVALID_THREAD_QUERY: 'owner.thread.invalid-query',
  CODEX_START_REQUIRED: 'owner.runtime.start-required',
  CODEX_PROTOCOL_ERROR: 'owner.runtime.invalid-response',
  INVALID_TURN_REQUEST: 'owner.turn.invalid-request',
  CODEX_UNAVAILABLE: 'owner.runtime.unavailable',
  RESOURCE_NOT_FOUND: 'owner.resource.not-found',
  REMOTE_UNAVAILABLE: 'owner.remote.unavailable',
  REMOTE_RELAY_REQUIRED: 'owner.remote.relay-required',
  DEVICE_NOT_FOUND: 'owner.device.not-found',
} as const satisfies Record<string, OwnerPublicErrorCode>

export type LegacyOwnerErrorCode = keyof typeof LEGACY_OWNER_ERROR_CODES

const SAFE_ERROR_MESSAGES: Partial<Record<OwnerPublicErrorCode, string>> = {
  'owner.protocol.invalid-frame': 'The request frame is invalid.',
  'owner.protocol.frame-too-large': 'The request frame is too large.',
  'owner.protocol.text-frame-required': 'A text frame is required.',
  'owner.protocol.invalid-handshake': 'The connection handshake is invalid.',
  'owner.auth.unauthorized': 'Authentication is required.',
  'owner.auth.local-transport-required': 'This method requires a local connection.',
  'owner.auth.origin-not-allowed': 'This connection origin is not allowed.',
  'owner.auth.unavailable': 'Authentication is temporarily unavailable.',
  'owner.auth.passkey-invalid': 'Passkey verification failed.',
  'owner.auth.passkey-required': 'A Passkey is required.',
  'owner.auth.challenge-expired': 'The Passkey challenge has expired.',
  'owner.auth.session-revoked': 'This session has been revoked.',
  'owner.auth.session-expired': 'This session has expired.',
  'owner.auth.step-up-required': 'Additional authentication is required.',
  'owner.enrollment.ticket-invalid': 'The enrollment ticket is invalid or expired.',
  'owner.request.duplicate-id': 'Request ID has already been used on this connection.',
  'owner.request.limit-exceeded': 'Too many requests are active on this connection.',
  'owner.request.timeout': 'The request timed out.',
  'owner.request.cancelled': 'The request was cancelled.',
  'owner.request.method-not-found': 'The requested method is not available.',
  'owner.request.invalid-params': 'Request parameters are invalid.',
  'owner.internal.unavailable': 'The request failed.',
  'owner.stream.backpressure-limit': 'The connection send queue exceeded its limit.',
  'owner.events.subscription-expired': 'The event subscription has expired.',
  'owner.events.invalid-cursor': 'The event cursor is invalid.',
  'owner.events.invalid-stream': 'The event stream is invalid.',
  'owner.setup.already-initialized': 'An Owner account already exists.',
  'owner.credential.invalid': 'Credential input is invalid.',
  'owner.credential.not-found': 'Credential was not found.',
  'owner.project.not-found': 'Project was not found.',
  'owner.project.already-exists': 'Project already exists.',
  'owner.thread.not-found': 'Thread was not found.',
  'owner.thread.invalid-id': 'Thread identifier is invalid.',
  'owner.thread.invalid-query': 'Thread query is invalid.',
  'owner.runtime.start-required': 'Start Codex before using this method.',
  'owner.runtime.invalid-response': 'Codex returned an invalid response.',
  'owner.runtime.unavailable': 'Codex is unavailable.',
  'owner.turn.invalid-request': 'Turn request is invalid.',
  'owner.resource.not-found': 'The requested resource was not found.',
  'owner.remote.unavailable': 'Remote administration is unavailable.',
  'owner.remote.relay-required': 'A relay URL is required for pairing.',
  'owner.device.not-found': 'Paired device was not found.',
}

export function mapOwnerErrorCode(code: string): OwnerPublicErrorCode {
  if (isOwnerPublicErrorCode(code)) return code
  return LEGACY_OWNER_ERROR_CODES[code as LegacyOwnerErrorCode] ?? 'owner.internal.unavailable'
}

export class OwnerMethodError extends DiagnosticError {
  readonly params?: Readonly<Record<string, PublicErrorParameter>>

  constructor(
    code: string,
    retryable = false,
    options?: ErrorOptions & { params?: Readonly<Record<string, PublicErrorParameter>> },
  ) {
    super(mapOwnerErrorCode(code), {
      level: 'error',
      retryable,
      ...(options?.cause === undefined ? {} : { cause: options.cause }),
    })
    this.name = 'OwnerMethodError'
    this.params = options?.params
  }
}

export class AuthDomainError extends DiagnosticError {
  constructor(code: string, options?: ErrorOptions) {
    super(mapOwnerErrorCode(code), {
      level: 'error',
      retryable: false,
      ...(options?.cause === undefined ? {} : { cause: options.cause }),
    })
    this.name = 'AuthDomainError'
  }
}

export function projectOwnerError(error: unknown): PublicErrorDto {
  if (!(error instanceof DiagnosticError))
    return createPublicError({
      code: 'owner.internal.unavailable',
      message: SAFE_ERROR_MESSAGES['owner.internal.unavailable'],
      retryable: true,
    })

  const code = mapOwnerErrorCode(error.code)
  const message = SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES['owner.internal.unavailable']
  const params = error instanceof OwnerMethodError ? error.params : undefined
  return createPublicError({
    code,
    ...(params ? { params } : {}),
    message,
    retryable: error.retryable,
  })
}

export function safeOwnerErrorCode(error: unknown): OwnerPublicErrorCode {
  return error instanceof DiagnosticError
    ? mapOwnerErrorCode(error.code)
    : 'owner.internal.unavailable'
}

function isOwnerPublicErrorCode(value: string): value is OwnerPublicErrorCode {
  return isKnownTelemetryErrorCode(value) && value.startsWith('owner.')
}
