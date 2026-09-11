import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSkills } from './skills'

describe('skills transport', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('reads only the safe projected skill metadata for a Project', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              handle: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
              name: 'skill-creator',
              displayName: 'Skill Creator',
              description: 'Create a Codex skill',
              scope: 'system',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(fetchSkills('project-1')).resolves.toEqual([
      {
        handle: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        name: 'skill-creator',
        displayName: 'Skill Creator',
        description: 'Create a Codex skill',
        scope: 'system',
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      '/api/skills?projectId=project-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('maps an unavailable Codex runtime to an actionable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'CODEX_START_REQUIRED' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(fetchSkills(null)).rejects.toMatchObject({
      code: 'CODEX_START_REQUIRED',
      message: 'Start Codex in Settings before loading skills.',
    })
  })
})
