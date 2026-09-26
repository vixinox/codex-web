import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRuntimeCapabilities } from './configuration'

describe('runtime capabilities transport', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('reads the model catalog returned by the capabilities endpoint', async () => {
    const catalog = {
      models: [
        {
          id: 'gpt-5.6-sol',
          displayName: 'GPT-5.6 Sol',
          defaultReasoningEffort: 'medium',
          reasoningEfforts: [{ id: 'low' }, { id: 'medium' }],
          inputModalities: ['text'],
        },
      ],
    }
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(fetchRuntimeCapabilities()).resolves.toEqual(catalog)
    expect(fetch).toHaveBeenCalledWith(
      '/api/capabilities',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})
