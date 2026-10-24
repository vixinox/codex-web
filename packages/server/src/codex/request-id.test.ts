import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRequestId, requestIdCandidates } from './request-id.js'

test('preserves canonical numeric and string request ids', () => {
  assert.equal(parseRequestId('42'), 42)
  assert.equal(parseRequestId('request-42'), 'request-42')
  assert.deepEqual(requestIdCandidates(42), [42, '42'])
  assert.deepEqual(requestIdCandidates('42'), ['42', 42])
})
