import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceSidebarController } from './use-workspace-sidebar-controller'

const bridge = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchThreads: vi.fn(),
  archiveThread: vi.fn(),
}))

vi.mock('@/lib/bridge/http/projects', () => bridge)
vi.mock('@/lib/bridge/http/threads', () => bridge)
vi.mock('@/lib/bridge/events/event-source', () => ({
  subscribeToEvents: vi.fn(() => () => undefined),
}))

const runtime = {
  model: { status: 'started', codex: {} },
  reportUnavailable: vi.fn(),
} as never

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('useWorkspaceSidebarController optimistic mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridge.fetchProjects.mockResolvedValue([{ id: 'p1', name: 'One' }])
    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(
        projectId === null
          ? [{ id: 'root-1', projectId: null, title: 'Root', status: 'idle', updatedAt: 2 }]
          : [{ id: 't1', projectId: 'p1', title: 'Chat', status: 'idle', updatedAt: 1 }],
      ),
    )
  })

  it('shows a project immediately and reconciles it with the server response', async () => {
    const request = deferred<{ id: string; name: string }>()
    bridge.createProject.mockReturnValue(request.promise)
    const { result } = renderHook(() => useWorkspaceSidebarController(runtime))
    await waitFor(() => expect(result.current.model.status).toBe('ready'))

    act(() => {
      void result.current.createProject('New project')
    })
    expect(result.current.model.status).toBe('ready')
    expect(result.current.model.projects.at(-1)).toMatchObject({
      name: 'New project',
      pending: true,
    })

    await act(async () => {
      request.resolve({ id: 'p2', name: 'New project' })
      await request.promise
    })
    await waitFor(() =>
      expect(result.current.model.projects.some(({ id }) => id === 'p2')).toBe(true),
    )
    expect(result.current.model.projects.some(({ pending }) => pending)).toBe(false)
  })

  it('removes a thread optimistically and restores it when archiving fails', async () => {
    const request = deferred<void>()
    bridge.archiveThread.mockReturnValue(request.promise)
    const { result } = renderHook(() => useWorkspaceSidebarController(runtime))
    await waitFor(() =>
      expect(
        result.current.model.status === 'ready' &&
          result.current.model.projects[0]?.threads.status === 'ready',
      ).toBe(true),
    )

    let operation!: Promise<void>
    act(() => {
      operation = result.current.archiveThread('p1', 't1')
    })
    expect(result.current.model.projects[0]?.threads).toMatchObject({ items: [] })

    await act(async () => {
      request.reject(new Error('Archive failed'))
      await expect(operation).rejects.toThrow('Archive failed')
    })
    expect(result.current.model.projects[0]?.threads).toMatchObject({
      items: [{ id: 't1', title: 'Chat' }],
    })
  })

  it('does not reorder threads when selecting one changes its server timestamp', async () => {
    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(
        projectId === null
          ? [
              { id: 'newer', projectId: null, title: 'Newer', status: 'idle', updatedAt: 20 },
              { id: 'older', projectId: null, title: 'Older', status: 'idle', updatedAt: 10 },
            ]
          : [],
      ),
    )
    const { result } = renderHook(() => useWorkspaceSidebarController(runtime))
    await waitFor(() =>
      expect(
        result.current.model.status === 'ready' &&
          result.current.model.rootThreads.status === 'ready' &&
          result.current.model.rootThreads.items.map(({ id }) => id),
      ).toEqual(['newer', 'older']),
    )

    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(
        projectId === null
          ? [
              { id: 'older', projectId: null, title: 'Older', status: 'idle', updatedAt: 30 },
              { id: 'newer', projectId: null, title: 'Newer', status: 'idle', updatedAt: 20 },
            ]
          : [],
      ),
    )
    act(() => result.current.retryRootThreads())

    await waitFor(() => expect(result.current.model.rootThreads.status).toBe('ready'))
    expect(result.current.model).toMatchObject({
      rootThreads: { items: [{ id: 'newer' }, { id: 'older' }] },
    })
  })

  it('uses the initial server order instead of sorting timestamps', async () => {
    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(
        projectId === null
          ? [
              { id: 'first', projectId: null, title: 'First', status: 'idle', updatedAt: 1 },
              { id: 'second', projectId: null, title: 'Second', status: 'idle', updatedAt: 2 },
            ]
          : [],
      ),
    )
    const { result } = renderHook(() => useWorkspaceSidebarController(runtime))

    await waitFor(() => expect(rootThreadIds(result.current.model)).toEqual(['first', 'second']))
  })

  it('promotes only through the explicit controller action, not busy-state hydration', async () => {
    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(
        projectId === null
          ? [
              { id: 'first', projectId: null, title: 'First', status: 'idle', updatedAt: 2 },
              { id: 'second', projectId: null, title: 'Second', status: 'idle', updatedAt: 1 },
            ]
          : [],
      ),
    )
    const { result, rerender } = renderHook(
      ({ active }) => useWorkspaceSidebarController(runtime, active),
      {
        initialProps: {
          active: { projectId: null, threadId: 'second', isBusy: false } as const,
        },
      },
    )
    await waitFor(() => expect(rootThreadIds(result.current.model)).toEqual(['first', 'second']))

    rerender({ active: { projectId: null, threadId: 'second', isBusy: true } as const })
    await waitFor(() => expect(bridge.fetchThreads).toHaveBeenCalledTimes(3))
    expect(rootThreadIds(result.current.model)).toEqual(['first', 'second'])

    act(() => result.current.promoteThread(null, 'second'))
    expect(rootThreadIds(result.current.model)).toEqual(['second', 'first'])
  })

  it('keeps a promoted new thread first when it arrives in a later refresh', async () => {
    const rootItems = [
      { id: 'first', projectId: null, title: 'First', status: 'idle', updatedAt: 2 },
      { id: 'second', projectId: null, title: 'Second', status: 'idle', updatedAt: 1 },
    ]
    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(projectId === null ? rootItems : []),
    )
    const { result } = renderHook(() => useWorkspaceSidebarController(runtime))
    await waitFor(() => expect(rootThreadIds(result.current.model)).toEqual(['first', 'second']))

    act(() => result.current.promoteThread(null, 'new'))
    rootItems.unshift({
      id: 'new',
      projectId: null,
      title: 'New',
      status: 'active',
      updatedAt: 3,
    })
    act(() => result.current.retryRootThreads())

    await waitFor(() =>
      expect(rootThreadIds(result.current.model)).toEqual(['new', 'first', 'second']),
    )
  })

  it('promotes a project thread without changing root-thread order', async () => {
    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(
        projectId === null
          ? [
              { id: 'root-1', projectId: null, title: 'Root 1', status: 'idle', updatedAt: 2 },
              { id: 'root-2', projectId: null, title: 'Root 2', status: 'idle', updatedAt: 1 },
            ]
          : [
              { id: 'project-1', projectId, title: 'Project 1', status: 'idle', updatedAt: 2 },
              { id: 'project-2', projectId, title: 'Project 2', status: 'idle', updatedAt: 1 },
            ],
      ),
    )
    const { result } = renderHook(() => useWorkspaceSidebarController(runtime))
    await waitFor(() => expect(projectThreadIds(result.current.model, 'p1')).not.toBeNull())

    act(() => result.current.promoteThread('p1', 'project-2'))

    expect(projectThreadIds(result.current.model, 'p1')).toEqual(['project-2', 'project-1'])
    expect(rootThreadIds(result.current.model)).toEqual(['root-1', 'root-2'])
  })

  it('inserts externally discovered threads without reordering known threads', async () => {
    let rootItems = [
      { id: 'first', projectId: null, title: 'First', status: 'idle', updatedAt: 2 },
      { id: 'second', projectId: null, title: 'Second', status: 'idle', updatedAt: 1 },
    ]
    bridge.fetchThreads.mockImplementation((projectId: string | null) =>
      Promise.resolve(projectId === null ? rootItems : []),
    )
    const { result } = renderHook(() => useWorkspaceSidebarController(runtime))
    await waitFor(() => expect(rootThreadIds(result.current.model)).toEqual(['first', 'second']))

    rootItems = [
      { id: 'external', projectId: null, title: 'External', status: 'idle', updatedAt: 3 },
      rootItems[1],
      rootItems[0],
    ]
    act(() => result.current.retryRootThreads())

    await waitFor(() =>
      expect(rootThreadIds(result.current.model)).toEqual(['external', 'first', 'second']),
    )
  })
})

function rootThreadIds(model: ReturnType<typeof useWorkspaceSidebarController>['model']) {
  return model.status === 'ready' && model.rootThreads.status === 'ready'
    ? model.rootThreads.items.map(({ id }) => id)
    : null
}

function projectThreadIds(
  model: ReturnType<typeof useWorkspaceSidebarController>['model'],
  projectId: string,
) {
  if (model.status !== 'ready') return null
  const project = model.projects.find(({ id }) => id === projectId)
  return project?.threads.status === 'ready' ? project.threads.items.map(({ id }) => id) : null
}
