import { afterEach, describe, expect, it, vi } from 'vitest'

import { setOwnerBridge } from '@/lib/bridge/owner-runtime'
import { ownerWorkspace } from './owner-workspace'

afterEach(() => setOwnerBridge(null))

describe('ownerWorkspace list adapters', () => {
  it('maps the Owner projects response to its list', async () => {
    setOwnerBridge({
      request: vi.fn().mockResolvedValue({
        projects: [{ id: 'project-1', name: 'Workspace' }],
      }),
      openStream: () => ({ streamId: null, cancel: () => undefined }),
    })

    await expect(ownerWorkspace.projects.list()).resolves.toEqual([
      { id: 'project-1', name: 'Workspace' },
    ])
  })

  it('maps paged Owner thread results and preserves an explicit root project scope', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'ok',
        data: [{ id: 'thread-1', title: 'Chat 1', updatedAt: 123, projectId: null }],
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        kind: 'ok',
        data: [{ id: 'thread-2', title: 'Chat 2', updatedAt: 122, projectId: null }],
        nextCursor: null,
      })
    setOwnerBridge({
      request,
      openStream: () => ({ streamId: null, cancel: () => undefined }),
    })

    await expect(ownerWorkspace.threads.list(null, undefined, true)).resolves.toEqual([
      { id: 'thread-1', title: 'Chat 1', updatedAt: 123, projectId: null },
      { id: 'thread-2', title: 'Chat 2', updatedAt: 122, projectId: null },
    ])
    expect(request).toHaveBeenCalledWith(
      'threads.list',
      { projectId: null, archived: true, limit: 100 },
      { signal: undefined },
    )
    expect(request).toHaveBeenLastCalledWith(
      'threads.list',
      { projectId: null, archived: true, limit: 100, cursor: 'cursor-2' },
      { signal: undefined },
    )
  })
})
