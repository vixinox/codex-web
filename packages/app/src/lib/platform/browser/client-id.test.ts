import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClientId } from './client-id'

describe('createClientId', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('uses randomUUID when the browser provides it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'native-id' })
    expect(createClientId()).toBe('native-id')
  })

  it('supports browsers without randomUUID through getRandomValues', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0)
        return bytes
      },
    })
    expect(createClientId()).toBe('00000000-0000-4000-8000-000000000000')
  })
})
