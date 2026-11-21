import assert from 'node:assert/strict'
import test from 'node:test'

import { TelemetryErrorCode } from '@codex-web/telemetry/errors'
import { AuthDomainError } from './errors.js'
import { mapOwnerErrorCode, OwnerMethodError, projectOwnerError } from './errors.js'

test('legacy Owner and auth codes map into the frozen namespaced catalog', () => {
  const legacyCodes = {
    INVALID_JSON: 'owner.protocol.invalid-frame',
    FRAME_TOO_LARGE: 'owner.protocol.frame-too-large',
    UNAUTHORIZED: 'owner.auth.unauthorized',
    AUTH_UNAVAILABLE: 'owner.auth.unavailable',
    PASSKEY_INVALID: 'owner.auth.passkey-invalid',
    ENROLLMENT_TICKET_REQUIRED: 'owner.enrollment.ticket-invalid',
    SESSION_REVOKED: 'owner.auth.session-revoked',
    SESSION_EXPIRED: 'owner.auth.session-expired',
    STEP_UP_REQUIRED: 'owner.auth.step-up-required',
    INVALID_EVENT_ENVELOPE: 'owner.events.invalid-stream',
    CODEX_UNAVAILABLE: 'owner.runtime.unavailable',
  } as const
  for (const [legacy, expected] of Object.entries(legacyCodes))
    assert.equal(mapOwnerErrorCode(legacy), expected)
  assert.ok(Object.values(TelemetryErrorCode).includes('owner.auth.unauthorized'))
})

test('unknown diagnostics project to a generic safe Owner DTO', () => {
  const error = new OwnerMethodError('unknown legacy code', true, {
    cause: new Error('secret token=abc C:\\private\\path'),
  })
  assert.deepEqual(projectOwnerError(error), {
    code: 'owner.internal.unavailable',
    retryable: true,
    message: 'The request failed.',
  })
  assert.deepEqual(projectOwnerError(new Error('raw internal detail')), {
    code: 'owner.internal.unavailable',
    retryable: true,
    message: 'The request failed.',
  })
})

test('auth diagnostics use explicit non-retryable classifications', () => {
  const error = new AuthDomainError('PASSKEY_INVALID', { cause: new Error('sensitive detail') })
  assert.equal(error.code, 'owner.auth.passkey-invalid')
  assert.equal(error.retryable, false)
  assert.equal(projectOwnerError(error).message, 'Passkey verification failed.')
})

test('retains original causes as Owner details only when explicitly requested', () => {
  const cause = new Error('failed at C:/private/path')
  Object.assign(cause, { details: 'upstream diagnostic' })
  const error = new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause })
  const generic = projectOwnerError(error)
  assert.equal(generic.message, 'Codex is unavailable.')
  assert.equal('details' in generic, false)
  const detailed = projectOwnerError(error, true)
  assert.equal(detailed.message, 'failed at C:/private/path')
  assert.equal(detailed.details, 'upstream diagnostic')
  assert.equal(JSON.stringify(detailed).includes('stack'), false)
})
