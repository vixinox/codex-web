import assert from 'node:assert/strict'
import test from 'node:test'

import { createServerLogger } from './logger.js'

test('server logger rejects invalid LOG_LEVEL without exposing the configured value', () => {
  const previous = process.env.LOG_LEVEL
  process.env.LOG_LEVEL = 'secret-token-value'
  try {
    assert.throws(
      () => createServerLogger(),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, 'Invalid LOG_LEVEL')
        assert.doesNotMatch(error.message, /secret-token-value/u)
        return true
      },
    )
  } finally {
    if (previous === undefined) delete process.env.LOG_LEVEL
    else process.env.LOG_LEVEL = previous
  }
})

test('server logger defaults to info when LOG_LEVEL is absent', () => {
  const previous = process.env.LOG_LEVEL
  delete process.env.LOG_LEVEL
  try {
    assert.doesNotThrow(() => createServerLogger())
  } finally {
    if (previous !== undefined) process.env.LOG_LEVEL = previous
  }
})
