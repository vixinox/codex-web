export type PublicErrorParameter = string | number | boolean

export const TelemetryErrorCode = {
  ownerProtocolInvalidFrame: 'owner.protocol.invalid-frame',
  ownerProtocolFrameTooLarge: 'owner.protocol.frame-too-large',
  ownerProtocolTextFrameRequired: 'owner.protocol.text-frame-required',
  ownerProtocolInvalidHandshake: 'owner.protocol.invalid-handshake',
  ownerAuthUnauthorized: 'owner.auth.unauthorized',
  ownerAuthLocalTransportRequired: 'owner.auth.local-transport-required',
  ownerAuthOriginNotAllowed: 'owner.auth.origin-not-allowed',
  ownerAuthUnavailable: 'owner.auth.unavailable',
  ownerAuthPasskeyInvalid: 'owner.auth.passkey-invalid',
  ownerAuthPasskeyRequired: 'owner.auth.passkey-required',
  ownerAuthChallengeExpired: 'owner.auth.challenge-expired',
  ownerAuthSessionRevoked: 'owner.auth.session-revoked',
  ownerAuthSessionExpired: 'owner.auth.session-expired',
  ownerAuthStepUpRequired: 'owner.auth.step-up-required',
  ownerEnrollmentTicketInvalid: 'owner.enrollment.ticket-invalid',
  ownerRequestDuplicateId: 'owner.request.duplicate-id',
  ownerRequestLimitExceeded: 'owner.request.limit-exceeded',
  ownerRequestTimeout: 'owner.request.timeout',
  ownerRequestCancelled: 'owner.request.cancelled',
  ownerRequestMethodNotFound: 'owner.request.method-not-found',
  ownerRequestInvalidParams: 'owner.request.invalid-params',
  ownerInternalUnavailable: 'owner.internal.unavailable',
  ownerStreamBackpressureLimit: 'owner.stream.backpressure-limit',
  ownerEventsSubscriptionExpired: 'owner.events.subscription-expired',
  ownerEventsInvalidCursor: 'owner.events.invalid-cursor',
  ownerEventsInvalidStream: 'owner.events.invalid-stream',
  ownerSetupAlreadyInitialized: 'owner.setup.already-initialized',
  ownerCredentialInvalid: 'owner.credential.invalid',
  ownerCredentialNotFound: 'owner.credential.not-found',
  ownerProjectNotFound: 'owner.project.not-found',
  ownerProjectAlreadyExists: 'owner.project.already-exists',
  ownerThreadNotFound: 'owner.thread.not-found',
  ownerThreadInvalidId: 'owner.thread.invalid-id',
  ownerThreadInvalidQuery: 'owner.thread.invalid-query',
  ownerRuntimeStartRequired: 'owner.runtime.start-required',
  ownerRuntimeInvalidResponse: 'owner.runtime.invalid-response',
  ownerRuntimeUnavailable: 'owner.runtime.unavailable',
  ownerTurnInvalidRequest: 'owner.turn.invalid-request',
  ownerResourceNotFound: 'owner.resource.not-found',
  ownerRemoteUnavailable: 'owner.remote.unavailable',
  ownerRemoteRelayRequired: 'owner.remote.relay-required',
  ownerDeviceNotFound: 'owner.device.not-found',
  relayAttachInvalidFrame: 'relay.attach.invalid-frame',
  relayAttachUnauthorized: 'relay.attach.unauthorized',
  relayAttachCapacity: 'relay.attach.capacity',
  relayAttachDuplicate: 'relay.attach.duplicate',
  relayAttachOwnerConflict: 'relay.attach.owner-conflict',
  relayEnrollmentReferenceInvalid: 'relay.enrollment.reference-invalid',
  relayConnectionPeerDisconnected: 'relay.connection.peer-disconnected',
  relayConnectionReplaced: 'relay.connection.replaced',
  relayConnectionSlowConsumer: 'relay.connection.slow-consumer',
  relayConnectionClosedByOwner: 'relay.connection.closed-by-owner',
  relayFrameInvalid: 'relay.frame.invalid',
  relayFrameTooLarge: 'relay.frame.too-large',
} as const

export type KnownTelemetryErrorCode = (typeof TelemetryErrorCode)[keyof typeof TelemetryErrorCode]
export type TelemetryErrorCode = KnownTelemetryErrorCode | (string & {})

export function isKnownTelemetryErrorCode(value: unknown): value is KnownTelemetryErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(TelemetryErrorCode).includes(value as KnownTelemetryErrorCode)
  )
}

export type PublicErrorDto = {
  code: TelemetryErrorCode
  params?: Readonly<Record<string, PublicErrorParameter>>
  retryable: boolean
  message?: string
}

export type PublicErrorProjection = PublicErrorDto

export function createPublicError(projection: PublicErrorProjection): PublicErrorDto {
  if (!isNamespacedErrorCode(projection.code)) throw new TypeError('Public error code is invalid')
  return {
    code: projection.code,
    ...(projection.params ? { params: sanitizeParameters(projection.params) } : {}),
    retryable: projection.retryable,
    ...(projection.message ? { message: sanitizeText(projection.message) } : {}),
  }
}

export function isPublicErrorDto(value: unknown): value is PublicErrorDto {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => !['code', 'params', 'retryable', 'message'].includes(key)))
    return false
  if (!isNamespacedErrorCode(value.code) || typeof value.retryable !== 'boolean') return false
  if (
    value.message !== undefined &&
    (typeof value.message !== 'string' ||
      value.message.length > 500 ||
      sanitizeText(value.message) !== value.message)
  )
    return false
  if (value.params !== undefined) {
    if (!isRecord(value.params)) return false
    if (Object.keys(value.params).length > 32) return false
    for (const [key, parameter] of Object.entries(value.params)) {
      if (
        SENSITIVE_KEY.test(key) ||
        DANGEROUS_KEY.test(key) ||
        key.length === 0 ||
        key.length > 64 ||
        sanitizeText(key) !== key
      )
        return false
      if (!isPublicErrorParameter(parameter)) return false
      if (
        typeof parameter === 'string' &&
        (parameter.length > 200 || sanitizeText(parameter) !== parameter)
      )
        return false
    }
  }
  return true
}

function sanitizeParameters(
  parameters: Readonly<Record<string, PublicErrorParameter>>,
): Record<string, PublicErrorParameter> {
  const safe: Record<string, PublicErrorParameter> = {}
  for (const [key, value] of Object.entries(parameters).slice(0, 32)) {
    if (SENSITIVE_KEY.test(key) || DANGEROUS_KEY.test(key)) continue
    if (!isPublicErrorParameter(value)) continue
    const safeKey = sanitizeText(key).slice(0, 64)
    if (!safeKey) continue
    safe[safeKey] = typeof value === 'string' ? sanitizeText(value).slice(0, 200) : value
  }
  return safe
}

function sanitizeText(value: string) {
  return value
    .replace(
      /(api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z]:\\[^\r\n]*/g, '[path]')
    .replace(/(?:^|\s)(?:\/[^\s]+){2,}/g, ' [path]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
    .slice(0, 500)
}

const SENSITIVE_KEY =
  /api[_-]?key|authorization|bearer|token|secret|password|private[_-]?key|path|cwd|workdir|directory/i
const DANGEROUS_KEY = /^(?:__proto__|prototype|constructor)$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPublicErrorParameter(value: unknown): value is PublicErrorParameter {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  )
}

function isNamespacedErrorCode(value: unknown): value is TelemetryErrorCode {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){2,}$/u.test(value)
  )
}
