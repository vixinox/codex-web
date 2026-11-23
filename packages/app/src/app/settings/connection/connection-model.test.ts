import { describe, expect, it } from 'vitest'
import {
  emptyConnectionSnapshot,
  formatDeviceDate,
  parseEnrollmentInvitation,
} from './connection-model'

describe('connection model', () => {
  it('starts with an explicit empty safe state', () => {
    expect(emptyConnectionSnapshot()).toEqual({
      remotePasskeyAvailable: false,
      localPasskeyAvailable: false,
      currentDeviceId: null,
      devices: [],
    })
  })
  it('formats missing and malformed dates safely', () => {
    expect(formatDeviceDate(null)).toBe('Never')
    expect(formatDeviceDate('invalid')).toBe('Unknown')
  })
  it('accepts a reference-only enrollment invitation', () => {
    const invitation = {
      reference: 'enrollment-reference-1234',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }
    expect(parseEnrollmentInvitation(invitation)).toEqual(invitation)
    expect(parseEnrollmentInvitation({ invitation })).toEqual(invitation)
    expect(() =>
      parseEnrollmentInvitation({ ...invitation, relayUrl: 'https://example.test' }),
    ).toThrow()
    expect(() => parseEnrollmentInvitation({ ...invitation, reference: 'short' })).toThrow()
  })
})
