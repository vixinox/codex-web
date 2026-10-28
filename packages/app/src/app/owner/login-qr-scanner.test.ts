import { describe, expect, it } from 'vitest'
import { parseLoginQrPayload } from './login-qr-scanner'

const validPayload = {
  version: 1,
  relayUrl: 'wss://relay.example.test/ws',
  ownerCode: '123456789',
  nodeId: 'owner-node',
  trustEpoch: 2,
  ownerPublicKey: '{"kty":"EC"}',
  ownerPublicKeyFingerprint: 'abcdefghijklmnop',
  capability: 'x'.repeat(32),
}

describe('login QR payload', () => {
  it('parses the supported bounded capability payload', () => {
    expect(parseLoginQrPayload(JSON.stringify(validPayload))).toEqual(validPayload)
  })

  it.each([
    { ...validPayload, relayUrl: 'javascript:alert(1)' },
    { ...validPayload, ownerCode: 'not-a-code' },
    { ...validPayload, ownerPublicKeyFingerprint: 'too-short' },
    { ...validPayload, extra: 'unexpected' },
    { ...validPayload, capability: 'short' },
  ])('rejects invalid or unexpected QR fields', (payload) => {
    expect(() => parseLoginQrPayload(JSON.stringify(payload))).toThrow()
  })

  it.each(['', 'not an image payload', '{broken', JSON.stringify({ type: 'other' })])(
    'rejects a failed decode or unsupported QR value (%s)',
    (raw) => {
      expect(() => parseLoginQrPayload(raw)).toThrow()
    },
  )
})
