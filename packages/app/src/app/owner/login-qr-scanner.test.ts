import { describe, expect, it } from 'vitest'
import { parseLoginQrPayload } from './login-qr-scanner'

const validReference = 'bootstrap-reference-1234'
const validUrl = `${window.location.origin}/app/first-session?ref=${validReference}`

describe('login QR reference', () => {
  it('parses a short first-session reference URL', () => {
    expect(parseLoginQrPayload(validUrl)).toMatchObject({
      version: 1,
      type: 'first_session',
      reference: validReference,
      relayUrl: expect.stringMatching(/^ws:\/\//u),
    })
  })

  it.each([
    'https://codex.vixinox.com/app/first-session?payload=%7B%22grant%22%3A%22secret%22%7D',
    'http://localhost/app/first-session?ref=short',
    'http://localhost/app/first-session?ref=bootstrap-reference-1234&grant=secret',
    'http://localhost:5173/first-session?ref=bootstrap-reference-1234',
    'https://other.example/app/first-session?ref=bootstrap-reference-1234',
    'not a URL',
    '',
  ])('rejects payload-bearing or malformed QR values (%s)', (raw) => {
    expect(() => parseLoginQrPayload(raw)).toThrow()
  })
})
