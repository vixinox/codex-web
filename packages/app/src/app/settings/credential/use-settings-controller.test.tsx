import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { useSettingsController } from './use-settings-controller'

function runtime(status: 'started' | 'stopped') {
  const restart = vi.fn().mockResolvedValue(true)
  const refresh = vi.fn().mockResolvedValue(undefined)
  const model: CodexRuntimeController['model'] =
    status === 'started'
      ? {
          status: 'started',
          codex: {
            status: 'ready',
            projectId: null,
            activeCredentialId: 'credential-1',
            currentCredentialId: 'credential-1',
            pendingCredentialId: null,
            restartRequired: false,
            activeTurns: 0,
            error: null,
          },
        }
      : { status: 'stopped', currentCredentialId: 'credential-1' }
  return {
    controller: {
      model,
      bootstrapping: false,
      errorEvent: null,
      start: vi.fn().mockResolvedValue(true),
      restart,
      refresh,
      reportUnavailable: vi.fn(),
    } satisfies CodexRuntimeController,
    restart,
    refresh,
  }
}

describe('useSettingsController', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['stopped', false],
    ['started', true],
  ] as const)(
    'persists a selection and restarts only when Codex is %s',
    async (status, restarts) => {
      const fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        if (String(input) === '/api/credentials')
          return Promise.resolve(
            Response.json({
              credentials: [
                { id: 'credential-1', provider: 'proxy', baseUrl: 'https://one.example.com' },
                { id: 'credential-2', provider: 'proxy', baseUrl: 'https://two.example.com' },
              ],
              currentCredentialId: 'credential-1',
            }),
          )
        if (String(input) === '/api/credentials/current')
          return Promise.resolve(Response.json({ currentCredentialId: 'credential-2' }))
        return Promise.resolve(Response.json({}))
      })
      vi.stubGlobal('fetch', fetch)
      const source = runtime(status)
      const { result } = renderHook(() => useSettingsController(source.controller))
      await waitFor(() => expect(result.current.credentials.status).toBe('ready'))

      await act(async () => {
        await result.current.selectCredential('credential-2')
      })

      expect(result.current.selectedCredentialId).toBe('credential-2')
      expect(source.restart).toHaveBeenCalledTimes(restarts ? 1 : 0)
      expect(source.refresh).toHaveBeenCalledTimes(restarts ? 0 : 1)
    },
  )

  it('returns false and exposes validation errors without creating a credential', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ credentials: [], currentCredentialId: null }))
    vi.stubGlobal('fetch', fetch)
    const source = runtime('stopped')
    const { result } = renderHook(() => useSettingsController(source.controller))
    await waitFor(() => expect(result.current.credentials.status).toBe('ready'))

    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.saveCredential({
        provider: '',
        baseUrl: 'not-a-url',
        apiKey: '',
      })
    })

    expect(saved).toBe(false)
    expect(result.current.credentialErrors).toEqual({
      provider: 'Use up to 32 letters, numbers, dots, underscores, or hyphens.',
      baseUrl: 'Enter an absolute HTTP or HTTPS URL.',
      apiKey: 'API key is required.',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns true after creating and refreshing a credential', async () => {
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/credentials' && init?.method === 'POST')
        return Promise.resolve(
          Response.json({
            id: 'credential-1',
            provider: 'openai',
            baseUrl: 'https://api.openai.com',
          }),
        )
      return Promise.resolve(
        Response.json({
          credentials: [
            { id: 'credential-1', provider: 'openai', baseUrl: 'https://api.openai.com' },
          ],
          currentCredentialId: 'credential-1',
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    const source = runtime('stopped')
    const { result } = renderHook(() => useSettingsController(source.controller))
    await waitFor(() => expect(result.current.credentials.status).toBe('ready'))

    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.saveCredential({
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'secret',
      })
    })

    expect(saved).toBe(true)
    expect(result.current.credentials).toMatchObject({ status: 'ready' })
    expect(source.refresh).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      '/api/credentials',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          provider: 'openai',
          baseUrl: 'https://api.openai.com',
          apiKey: 'secret',
        }),
      }),
    )
  })

  it('throws and keeps the save unsuccessful when creating a credential fails', async () => {
    const fetch = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/credentials' && init?.method === 'POST')
        return Promise.resolve(
          Response.json({ error: { message: 'Unable to save.' } }, { status: 500 }),
        )
      return Promise.resolve(Response.json({ credentials: [], currentCredentialId: null }))
    })
    vi.stubGlobal('fetch', fetch)
    const source = runtime('stopped')
    const { result } = renderHook(() => useSettingsController(source.controller))
    await waitFor(() => expect(result.current.credentials.status).toBe('ready'))

    await expect(
      act(() =>
        result.current.saveCredential({
          provider: 'openai',
          baseUrl: 'https://api.openai.com',
          apiKey: 'secret',
        }),
      ),
    ).rejects.toThrow('Unable to save.')
    expect(source.refresh).not.toHaveBeenCalled()
  })
})
