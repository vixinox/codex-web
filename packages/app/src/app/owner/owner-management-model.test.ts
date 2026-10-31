import { describe, expect, it } from 'vitest'
import {
  emptyOwnerManagementSnapshot,
  formatDeviceDate,
  parseEnrollmentInvitation,
} from './owner-management-model'

describe('owner management model', () => {
  it('starts with an explicit empty safe state', () => {
    expect(emptyOwnerManagementSnapshot()).toEqual({
      remotePasskeyAvailable: false,
      localPasskeyAvailable: false,
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
