import assert from 'node:assert/strict'
import test from 'node:test'

import { formatRpcMessageId, summarizeRpcShape } from './rpc-message-summary.js'

test('summarizes structure and string lengths without including parameter values', () => {
  const summary = summarizeRpcShape({
    futureField: 'private chat body',
    nested: [{ delta: 'secret response text' }],
    token: 'credential-value',
    path: 'C:\\Users\\private\\file.txt',
  })

  assert.match(summary, /futureField:string\(chars=17\)/)
  assert.match(summary, /array\(length=1/)
  assert.match(summary, /\[sensitive-key\]:string\(chars=/)
  assert.doesNotMatch(summary, /private chat body|secret response text|credential-value|Users/)
})

test('bounds deep, wide, and large array summaries', () => {
  const deep = { a: { b: { c: { d: { e: 'hidden' } } } } }
  const wide = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`field${index}`, true]))
  const array = Array.from({ length: 100 }, () => ({ value: 'text' }))

  assert.ok(summarizeRpcShape(deep).length <= 1_000)
  assert.ok(summarizeRpcShape(wide).length <= 1_000)
  assert.ok(summarizeRpcShape(array).length <= 1_000)
  assert.match(summarizeRpcShape(wide), /…/)
  assert.match(summarizeRpcShape(array), /length=100/)
})

test('formats request IDs without exposing string values', () => {
  assert.equal(formatRpcMessageId(7), 'number:7')
  assert.match(formatRpcMessageId('request-secret'), /^string:length=14,fingerprint=/)
  assert.doesNotMatch(formatRpcMessageId('request-secret'), /request-secret/)
})
