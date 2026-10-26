import { afterEach, describe, expect, it } from 'vitest'

import { setOwnerBridge } from '@/lib/bridge/owner-runtime'
import { ownerSettings } from './owner-settings'

afterEach(() => setOwnerBridge(null))

describe('ownerSettings credentials', () => {
  it('maps the Owner credentials response to the settings collection shape', async () => {
    setOwnerBridge({
      request: async () => ({
        credentials: [
          { id: 'credential-1', provider: 'openai', baseUrl: 'https://api.example.com' },
        ],
        currentCredentialId: 'credential-1',
      }),
      openStream: () => ({ streamId: null, cancel: () => undefined }),
    })

    await expect(ownerSettings.credentials.list()).resolves.toEqual({
      items: [{ id: 'credential-1', provider: 'openai', baseUrl: 'https://api.example.com' }],
      currentCredentialId: 'credential-1',
    })
  })
})
