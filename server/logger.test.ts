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
