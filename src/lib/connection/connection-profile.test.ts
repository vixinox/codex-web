import { describe, expect, it } from 'vitest'
import { assessMetadata, connectionCapabilities } from './connection-profile'

const metadata = {
  product: 'codex-web' as const,
  protocolVersion: '2026-01',
  minClientVersion: '0.0.1',
  capabilities: ['threads', 'turns', 'sse', 'pwa', 'workspace', 'guest'],
  profile: 'guest' as const,
}

describe('connection metadata', () => {
  it('accepts the current protocol and projects safe capabilities', () => {
    expect(assessMetadata(metadata)).toBe('ready')
    expect(connectionCapabilities(metadata)).toEqual({
      mobile: true,
      notifications: false,
      fileWorkspace: true,
      guestMode: true,
    })
  })

  it('rejects incompatible protocol, client, and required capabilities', () => {
    expect(assessMetadata({ ...metadata, protocolVersion: '2025-01' })).toBe('incompatible')
    expect(assessMetadata({ ...metadata, minClientVersion: '9.0.0' })).toBe('incompatible')
    expect(assessMetadata({ ...metadata, minClientVersion: '10.0.0' })).toBe('incompatible')
    expect(assessMetadata({ ...metadata, capabilities: ['sse'] })).toBe('incompatible')
  })
})
