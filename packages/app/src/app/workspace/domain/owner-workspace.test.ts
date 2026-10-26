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

  it('maps paged Owner thread results and omits a null project scope', async () => {
    const request = vi.fn().mockResolvedValue({
      kind: 'ok',
      data: [{ id: 'thread-1', title: 'Chat', updatedAt: 123, projectId: null }],
      nextCursor: null,
    })
    setOwnerBridge({
      request,
      openStream: () => ({ streamId: null, cancel: () => undefined }),
    })

    await expect(ownerWorkspace.threads.list(null, undefined, true)).resolves.toEqual([
      { id: 'thread-1', title: 'Chat', updatedAt: 123, projectId: null },
    ])
    expect(request).toHaveBeenCalledWith('threads.list', { archived: true }, { signal: undefined })
  })
})
