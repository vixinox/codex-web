import { describe, expect, it } from 'vitest'
import { emptyOwnerManagementSnapshot, formatDeviceDate } from './owner-management-model'

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
})
