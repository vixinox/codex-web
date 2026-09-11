import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCredential, fetchCredentials, selectCurrentCredential } from './credentials'

describe('credential transport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('projects list responses without retaining secret fields', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          credentials: [
            {
              id: 'credential-1',
              provider: 'proxy',
              baseUrl: 'https://api.example.com',
              apiKey: 'should-not-cross-the-transport-boundary',
              encryptedApiKey: 'also-should-not-cross',
            },
          ],
          currentCredentialId: 'credential-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const credentials = await fetchCredentials()

    expect(credentials).toEqual({
      items: [{ id: 'credential-1', provider: 'proxy', baseUrl: 'https://api.example.com' }],
      currentCredentialId: 'credential-1',
    })
    expect(JSON.stringify(credentials)).not.toContain('apiKey')
    expect(fetch).toHaveBeenCalledWith(
      '/api/credentials',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('selects the current credential without exposing credential data', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ currentCredentialId: 'credential-2' }))
    vi.stubGlobal('fetch', fetch)

    await expect(selectCurrentCredential('credential-2')).resolves.toBe('credential-2')
    expect(fetch).toHaveBeenCalledWith(
      '/api/credentials/current',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ credentialId: 'credential-2' }),
        credentials: 'include',
      }),
    )
  })

  it('projects a saved credential response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'credential-1',
            provider: 'proxy',
            baseUrl: 'https://api.example.com',
            apiKey: 'secret',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(
      createCredential({ provider: 'proxy', baseUrl: 'https://api.example.com', apiKey: 'secret' }),
    ).resolves.toEqual({
      id: 'credential-1',
      provider: 'proxy',
      baseUrl: 'https://api.example.com',
    })
  })
})
