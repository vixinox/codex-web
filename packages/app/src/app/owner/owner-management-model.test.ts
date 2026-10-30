import { describe, expect, it } from 'vitest'
import {
  emptyOwnerManagementSnapshot,
  formatDeviceDate,
  parseManagementQrPayload,
} from './owner-management-model'

describe('owner management model', () => {
  it('starts with an explicit empty safe state', () => {
    expect(emptyOwnerManagementSnapshot()).toEqual({
      remotePasskeyAvailable: false,
      localPasskeyAvailable: false,
      recoveryCodesAvailable: false,
      devices: [],
    })
  })
  it('formats missing and malformed dates safely', () => {
    expect(formatDeviceDate(null)).toBe('Never')
    expect(formatDeviceDate('invalid')).toBe('Unknown')
  })
  it('accepts only short, unexpired management references', () => {
    const payload = {
      version: 1,
      type: 'management_request',
      reference: 'management-reference-1234',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    expect(parseManagementQrPayload(JSON.stringify(payload))).toEqual(payload)
    expect(() =>
      parseManagementQrPayload(JSON.stringify({ ...payload, ownerId: 'identity-material' })),
    ).toThrow()
  })
})
