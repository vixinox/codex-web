import assert from 'node:assert/strict'
import test from 'node:test'

import { safeError } from './logger.js'

test('safeError includes redacted causes for startup diagnostics', () => {
  const error = new Error('Guest runtime failed to start', {
    cause: new Error(
      'RPC rejected: apiKey=sk-secret at C:\\Users\\Hello\\Desktop\\codex-web\\.data',
    ),
  })
  const message = safeError(error)
  assert.match(message, /Guest runtime failed to start/)
  assert.match(message, /RPC rejected/)
  assert.doesNotMatch(message, /sk-secret/)
  assert.doesNotMatch(message, /C:\\Users/)
})

test('safeError includes aggregate connection causes', () => {
  const error = new AggregateError(
    [new Error('connect ECONNREFUSED 127.0.0.1:5432'), new Error('connect ECONNREFUSED ::1:5432')],
    '',
  )
  assert.match(safeError(error), /ECONNREFUSED/)
  assert.match(safeError(error), /127\.0\.0\.1:5432/)
})
