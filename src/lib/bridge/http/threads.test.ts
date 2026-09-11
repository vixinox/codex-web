import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cancelTurn,
  deleteAllArchivedThreads,
  deleteThread,
  fetchThread,
  fetchThreadRuntimeStatus,
  fetchThreads,
  startThread,
  startTurn,
  unarchiveThread,
} from './threads'

describe('thread list transport', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('reads every page and maps DTOs to sidebar summaries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'thread-1',
                projectId: 'project-1',
                title: 'Inspect the repository',
                status: 'idle',
                updatedAt: 2,
                modelProvider: 'private-provider',
              },
            ],
            nextCursor: 'page 2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'thread-2',
                projectId: 'project-1',
                title: 'Named thread',
                status: 'notLoaded',
                updatedAt: 1,
              },
            ],
            nextCursor: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(fetchThreads('project-1')).resolves.toEqual([
      {
        id: 'thread-1',
        projectId: 'project-1',
        title: 'Inspect the repository',
        status: 'idle',
        updatedAt: 2,
      },
      {
        id: 'thread-2',
        projectId: 'project-1',
        title: 'Named thread',
        status: 'notLoaded',
        updatedAt: 1,
      },
    ])
    expect(String(fetch.mock.calls[0]?.[0])).toContain('projectId=project-1')
    expect(String(fetch.mock.calls[1]?.[0])).toContain('cursor=page+2')
  })

  it('requests archived pages and sends archive management methods', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    await fetchThreads(null, undefined, true)
    expect(String(fetch.mock.calls[0]?.[0])).toContain('archived=true')

    fetch.mockResolvedValue(new Response(null, { status: 204 }))
    await unarchiveThread('project-1', 'thread-1')
    await deleteThread(null, 'thread-2')
    await deleteAllArchivedThreads()
    expect(fetch.mock.calls.slice(1).map(([url, init]) => [String(url), init?.method])).toEqual([
      ['/api/threads/thread-1/unarchive?projectId=project-1', 'POST'],
      ['/api/threads/thread-2', 'DELETE'],
      ['/api/threads?archived=true', 'DELETE'],
    ])
  })

  it('starts a Thread and first Turn without exposing protocol fields', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          threadId: 'thread-1',
          turnId: 'turn-1',
          projectId: null,
          cwd: 'C:/private/workspace',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      startThread({
        projectId: null,
        text: 'Inspect the workspace',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'low',
      }),
    ).resolves.toEqual({ threadId: 'thread-1', turnId: 'turn-1', projectId: null })
    expect(fetch).toHaveBeenCalledWith(
      '/api/threads',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          projectId: null,
          text: 'Inspect the workspace',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'low',
        }),
      }),
    )
  })

  it('starts a subsequent root Turn and projects only its identifier', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          turnId: 'turn-2',
          status: 'inProgress',
          cwd: 'C:/private/workspace',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(
      startTurn('thread-1', {
        projectId: null,
        text: 'Continue the analysis',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
      }),
    ).resolves.toEqual({ turnId: 'turn-2' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/threads/thread-1/turns',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          projectId: null,
          text: 'Continue the analysis',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'medium',
        }),
      }),
    )
  })

  it('serializes selected Skill handles without local paths', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ turnId: 'turn-2' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await startTurn('thread-1', {
      projectId: null,
      text: 'Create a report.',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      skillHandles: ['f47ac10b-58cc-4372-a567-0e02b2c3d479'],
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/threads/thread-1/turns',
      expect.objectContaining({
        body: expect.stringContaining('f47ac10b-58cc-4372-a567-0e02b2c3d479'),
      }),
    )
    expect(String(fetch.mock.calls[0]?.[1]?.body)).not.toContain('SKILL.md')
  })

  it('interrupts a Turn through the authenticated bridge', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await expect(cancelTurn('thread-1', 'turn-2')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(
      '/api/threads/thread-1/turns/turn-2/cancel',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
  })

  it('maps a stopped runtime to a safe initial submission error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'CODEX_START_REQUIRED' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(
      startThread({
        projectId: 'project-1',
        text: 'Start work',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'low',
      }),
    ).rejects.toMatchObject({
      message: 'Start Codex in Settings before sending a message.',
      code: 'CODEX_START_REQUIRED',
    })
  })

  it('uses a safe actionable message when Codex is stopped', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'CODEX_START_REQUIRED' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(fetchThreads('project-1')).rejects.toMatchObject({
      message: 'Start Codex in Settings to load threads.',
      code: 'CODEX_START_REQUIRED',
    })
  })

  it('lists root threads without sending a Project id', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'root-thread',
              projectId: null,
              title: 'Root thread',
              status: 'idle',
              updatedAt: 2,
            },
          ],
          nextCursor: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(fetchThreads(null)).resolves.toMatchObject([{ id: 'root-thread' }])
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/api/threads?limit=100')
  })

  it('reads a native Codex thread without accepting a server UI presentation', async () => {
    const thread = {
      id: 'thread-1',
      name: 'Existing thread',
      status: { type: 'idle' },
      turns: [{ id: 'turn-1', status: 'completed', items: [] }],
    }
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ thread, eventCursor: 7 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(fetchThread('project-1', 'thread-1')).resolves.toEqual({
      thread,
      eventCursor: 7,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/threads/thread-1?projectId=project-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })

  it('reads a root native thread without a Project field in the response', async () => {
    const thread = {
      id: 'root-thread',
      name: 'Root thread',
      status: { type: 'idle' },
      turns: [],
    }
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ thread, eventCursor: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(fetchThread(null, 'root-thread')).resolves.toEqual({
      thread,
      eventCursor: 0,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/threads/root-thread',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})

describe('thread runtime status transport', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('reads a validated lightweight status response', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          threadId: 'thread-1',
          projectId: 'project-1',
          status: 'inProgress',
          eventCursor: 12,
          activeTurnId: 'turn-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(fetchThreadRuntimeStatus('project-1', 'thread-1')).resolves.toEqual({
      threadId: 'thread-1',
      projectId: 'project-1',
      status: 'inProgress',
      eventCursor: 12,
      activeTurnId: 'turn-1',
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/threads/thread-1/status?projectId=project-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
  })
})
