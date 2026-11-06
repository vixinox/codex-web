import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TelemetryErrorCode,
  createPublicError,
  isKnownTelemetryErrorCode,
  isPublicErrorDto,
} from './errors.js'

test('public errors retain stable code and primitive parameters only', () => {
  const error = createPublicError({
    code: 'owner.request.failed',
    retryable: true,
    params: { attempt: 2, token: 'secret', label: 'turn-1' },
    message: 'Request failed at C:\\Users\\me\\workspace',
  })
  assert.deepEqual(error, {
    code: 'owner.request.failed',
    retryable: true,
    params: { attempt: 2, label: 'turn-1' },
    message: 'Request failed at [path]',
  })
  assert.equal(isPublicErrorDto(error), true)
})

test('public error guard rejects arbitrary parameter objects', () => {
  assert.equal(
    isPublicErrorDto({
      code: 'owner.test.invalid',
      retryable: false,
      params: { nested: { value: 'secret' } },
    }),
    false,
  )
  assert.equal(
    isPublicErrorDto({ code: 'owner.test.invalid', retryable: false, stack: 'private' }),
    false,
  )
  assert.equal(
    isPublicErrorDto({
      code: 'owner.test.invalid',
      retryable: false,
      message: 'Authorization: Bearer private-token',
    }),
    false,
  )
  assert.throws(
    () => createPublicError({ code: 'bad code with spaces', retryable: false }),
    /Public error code is invalid/,
  )
  assert.deepEqual(
    createPublicError({
      code: 'owner.valid.error',
      retryable: false,
      params: { nested: { value: 'secret' } } as never,
    }).params,
    {},
  )
})

test('error code catalog and forward-compatible namespaced DTOs are distinct', () => {
  assert.equal(isKnownTelemetryErrorCode(TelemetryErrorCode.ownerAuthPasskeyInvalid), true)
  assert.equal(isKnownTelemetryErrorCode('owner.future.new-reason'), false)
  assert.equal(
    isPublicErrorDto({ code: 'owner.future.new-reason', retryable: false, message: 'Try again.' }),
    true,
  )
  assert.equal(isPublicErrorDto({ code: 'relay.attach.unauthorized', retryable: false }), true)
  for (const code of [
    'INVALID_PARAMS',
    'owner.bad',
    'owner.bad reason',
    'owner.' + 'a'.repeat(128),
  ]) {
    assert.equal(isPublicErrorDto({ code, retryable: false }), false)
  }
})

test('public DTO guard rejects unsafe keys, values, bounds, and extra fields', () => {
  const invalid = [
    { code: 'owner.request.failed', retryable: false, extra: true },
    { code: 'owner.request.failed', retryable: 'false' },
    { code: 'owner.request.failed', retryable: false, params: { nested: {} } },
    { code: 'owner.request.failed', retryable: false, params: { count: Number.POSITIVE_INFINITY } },
    { code: 'owner.request.failed', retryable: false, params: { token: 'secret' } },
    { code: 'owner.request.failed', retryable: false, params: { label: 'x'.repeat(201) } },
    { code: 'owner.request.failed', retryable: false, message: 'x'.repeat(501) },
    { code: 'owner.request.failed', retryable: false, message: 'Bearer hidden-value' },
  ]
  for (const value of invalid) assert.equal(isPublicErrorDto(value), false)
  assert.equal(
    isPublicErrorDto({
      code: 'owner.request.failed',
      retryable: false,
      params: JSON.parse('{"__proto__":"bad"}'),
    }),
    false,
  )
})
