import assert from 'node:assert/strict'
import test from 'node:test'

import { guestTokenCapacity } from './guest-service.js'

test('reports the raw remainder without applying a per-turn reservation', () => {
  assert.deepEqual(guestTokenCapacity(256_000, 130_000), { available: 126_000 })
  assert.deepEqual(guestTokenCapacity(256_000, 128_000), { available: 128_000 })
})

test('does not report a negative token remainder', () => {
  assert.deepEqual(guestTokenCapacity(256_000, 300_000), { available: 0 })
})
