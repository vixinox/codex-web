import { describe, expect, it } from 'vitest'
import { parseLoginQrPayload } from './login-qr-scanner'

const validPayload = {
  version: 1,
  relayUrl: 'wss://relay.example.test/ws',
  ownerCode: '123456789',
  nodeId: 'owner-node',
  trustEpoch: 2,
  ownerPublicKey: '{"kty":"EC"}',
  ownerPublicKeyVerificationKey: '{"kty":"EC"}',
  ownerPublicKeyFingerprint: 'abcdefghijklmnop',
  type: 'first_session',
  grant: 'x'.repeat(32),
  expiresAt: '2026-10-30T12:05:00.000Z',
}

describe('login QR payload', () => {
  it('parses the supported first-session payload', () => {
    expect(parseLoginQrPayload(JSON.stringify(validPayload))).toEqual(validPayload)
  })

  it.each([
    { ...validPayload, relayUrl: 'javascript:alert(1)' },
    { ...validPayload, ownerCode: 'not-a-code' },
    { ...validPayload, ownerPublicKeyFingerprint: 'too-short' },
    { ...validPayload, extra: 'unexpected' },
    { ...validPayload, grant: 'short' },
  ])('rejects invalid or unexpected QR fields', (payload) => {
    expect(() => parseLoginQrPayload(JSON.stringify(payload))).toThrow()
  })

  it('parses the official first-session URL', () => {
    const url = new URL('https://codex.vixinox.com/app/first-session')
    url.searchParams.set('payload', JSON.stringify(validPayload))
    expect(parseLoginQrPayload(url.toString())).toEqual(validPayload)
  })

  it.each(['', 'not an image payload', '{broken', JSON.stringify({ type: 'other' })])(
    'rejects a failed decode or unsupported QR value (%s)',
    (raw) => {
      expect(() => parseLoginQrPayload(raw)).toThrow()
    },
  )
})
