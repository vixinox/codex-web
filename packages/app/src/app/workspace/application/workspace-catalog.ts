import type {
  WorkspaceProject,
  WorkspaceProjectSummary,
  WorkspaceSidebarModel,
  WorkspaceThread,
} from '@/app/workspace/workspace-model'
import type { ProjectSummary } from '@/app/workspace/domain/owner-workspace'
import { presentAppError } from '@/lib/errors/presentation'
import {
  applyOptimisticOperations,
  findThread,
  insertThread,
  mapProject,
  mapRootThreads,
  mapProjectThreads,
  mapThread,
  reconcileThreadOrder,
  removeProject,
  removeThread,
  reorderThreadInModel,
  threadIdsForScope,
  type CatalogThreadSummary,
  type OptimisticOperation,
} from '@/app/workspace/domain/workspace-catalog-state'

export type WorkspaceCatalogRuntime = {
  ready: boolean
  onUnavailable: () => void
}

export type WorkspaceCatalogActiveThread = {
  projectId: string | null
  threadId: string
  isBusy: boolean
} | null

export type WorkspaceCatalogDependencies = {
  projects: {
    list: (signal: AbortSignal) => Promise<readonly WorkspaceProjectSummary[]>
    create: (name: string) => Promise<ProjectSummary>
    rename: (projectId: string, name: string) => Promise<ProjectSummary>
    delete: (projectId: string) => Promise<void>
  }
  threads: {
    list: (
      projectId: string | null,
      signal: AbortSignal,
    ) => Promise<readonly CatalogThreadSummary[]>
    archive: (projectId: string | null, threadId: string) => Promise<void>
    delete: (projectId: string | null, threadId: string) => Promise<void>
  }
  subscribeToWorkspaceEvents: (onEvent: (event: Event) => void) => () => void
  now?: () => number
}

export type WorkspaceCatalogActions = {
  promoteThread: (projectId: string | null, threadId: string) => void
  retryProjects: () => void
  retryThreads: (projectId: string) => void
  retryRootThreads: () => void
  archiveThread: (projectId: string | null, threadId: string) => Promise<void>
  beginThreadCreation: (
    projectId: string | null,
    title: string,
    content?: WorkspaceThread['sourceLabel'],
  ) => string
  failThreadCreation: (placeholderId: string, message: string) => void
  resolveThreadCreation: (placeholderId: string, projectId: string | null, threadId: string) => void
  deleteThread: (projectId: string | null, threadId: string) => Promise<void>
  createProject: (name: string) => Promise<ProjectSummary>
  renameProject: (projectId: string, name: string) => Promise<ProjectSummary>
  deleteProject: (projectId: string) => Promise<void>
}

/**
 * Owns workspace catalog loading, event reconciliation, optimistic mutations and ordering.
 * Callers observe a stable UI-facing model and issue actions without coordinating those details.
 */
export interface WorkspaceCatalog {
  readonly actions: WorkspaceCatalogActions
  getSnapshot: () => WorkspaceSidebarModel
  subscribe: (listener: () => void) => () => void
  connect: (runtime: WorkspaceCatalogRuntime) => void
  disconnect: () => void
  observeActiveThread: (activeThread: WorkspaceCatalogActiveThread) => void
}

type LoadOptions = {
  showLoading?: boolean
  preserveOnError?: boolean
  clearOperationId?: number
}

type ActiveThreadState = { key: string; busy: boolean }

const workspaceEvents = ['thread/archived', 'thread/unarchived', 'thread/closed', 'thread/deleted']

export function createWorkspaceCatalog(
  dependencies: WorkspaceCatalogDependencies,
): WorkspaceCatalog {
  let sourceModel: WorkspaceSidebarModel = { status: 'loading' }
  let operations: readonly OptimisticOperation[] = []
  let model: WorkspaceSidebarModel = sourceModel
  let runtime: WorkspaceCatalogRuntime = { ready: false, onUnavailable: () => undefined }
  let projectRequest: AbortController | null = null
  let rootRequest: AbortController | null = null
  const threadRequests = new Map<string, AbortController>()
  const threadOrder = new Map<string, readonly string[]>()
  const listeners = new Set<() => void>()
  let operationSequence = 0
  let observedThreadState: ActiveThreadState | null = null
  let unsubscribeEvents: (() => void) | null = null

  const getSnapshot = () => model
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const publish = () => {
    model = applyOptimisticOperations(sourceModel, operations)
    for (const listener of listeners) listener()
  }

  const updateSourceModel = (update: (current: WorkspaceSidebarModel) => WorkspaceSidebarModel) => {
    sourceModel = update(sourceModel)
    publish()
  }

  const updateOperations = (
    update: (current: readonly OptimisticOperation[]) => readonly OptimisticOperation[],
  ) => {
    operations = update(operations)
    publish()
  }

  const nextOperationId = () => ++operationSequence
  const clearOperation = (id: number) => {
    updateOperations((current) => current.filter((operation) => operation.id !== id))
  }

  const stopThreadRequests = () => {
    rootRequest?.abort()
    rootRequest = null
    for (const request of threadRequests.values()) request.abort()
    threadRequests.clear()
  }

  const loadRootThreads = (options: LoadOptions = {}) => {
    if (!runtime.ready) return
    rootRequest?.abort()
    const controller = new AbortController()
    rootRequest = controller
    if (options.showLoading ?? true) {
      updateSourceModel((current) =>
        current.status === 'ready' ? { ...current, rootThreads: { status: 'loading' } } : current,
      )
    }
    void dependencies.threads
      .list(null, controller.signal)
      .then((items) => {
        if (rootRequest !== controller) return
        updateSourceModel((current) =>
          current.status === 'ready'
            ? {
                ...current,
                rootThreads: {
                  status: 'ready',
                  items: reconcileThreadOrder(mapRootThreads(items), '<root>', threadOrder),
                },
              }
            : current,
        )
        if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        if (isCodexUnavailable(error)) runtime.onUnavailable()
        if (options.preserveOnError) {
          if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
          return
        }
        updateSourceModel((current) =>
          current.status === 'ready'
            ? {
                ...current,
                rootThreads: {
                  status: 'error',
                  message: presentAppError(error, 'Could not load threads. Try again.'),
                },
              }
            : current,
        )
      })
      .finally(() => {
        if (rootRequest === controller) rootRequest = null
      })
  }

  const loadThreads = (projectId: string, options: LoadOptions = {}) => {
    if (!runtime.ready) return
    threadRequests.get(projectId)?.abort()
    const controller = new AbortController()
    threadRequests.set(projectId, controller)
    if (options.showLoading ?? true) {
      updateSourceModel((current) =>
        mapProject(current, projectId, (project) => ({
          ...project,
          threads: { status: 'loading' },
        })),
      )
    }
    void dependencies.threads
      .list(projectId, controller.signal)
      .then((items) => {
        if (threadRequests.get(projectId) !== controller) return
        updateSourceModel((current) =>
          mapProject(current, projectId, (project) => ({
            ...project,
            threads: {
              status: 'ready',
              items: reconcileThreadOrder(
                mapProjectThreads(items, project.name),
                projectId,
                threadOrder,
              ),
            },
          })),
        )
        if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        if (isCodexUnavailable(error)) runtime.onUnavailable()
        if (options.preserveOnError) {
          if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
          return
        }
        updateSourceModel((current) =>
          mapProject(current, projectId, (project) => ({
            ...project,
            threads: {
              status: 'error',
              message: presentAppError(error, 'Could not load threads. Try again.'),
            },
          })),
        )
      })
      .finally(() => {
        if (threadRequests.get(projectId) === controller) threadRequests.delete(projectId)
      })
  }

  const loadProjects = () => {
    if (!runtime.ready) return
    projectRequest?.abort()
    const controller = new AbortController()
    projectRequest = controller
    queueMicrotask(() => {
      if (projectRequest === controller) updateSourceModel(() => ({ status: 'loading' }))
    })
    void dependencies.projects
      .list(controller.signal)
      .then((projects) => {
        if (projectRequest !== controller) return
        const nextProjects: WorkspaceProject[] = projects.map(({ id, name }) => ({
          id,
          name,
          threads: { status: 'loading' },
        }))
        updateSourceModel(() => ({
          status: 'ready',
          rootThreads: { status: 'loading' },
          projects: nextProjects,
        }))
        loadRootThreads()
        for (const project of nextProjects) loadThreads(project.id)
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || projectRequest !== controller) return
        if (isCodexUnavailable(error)) runtime.onUnavailable()
        updateSourceModel(() => ({
          status: 'error',
          message: presentAppError(error, 'Could not load projects. Try again.'),
        }))
      })
      .finally(() => {
        if (projectRequest === controller) projectRequest = null
      })
  }

  const onWorkspaceEvent = (event: Event) => {
    if (!workspaceEvents.includes(event.type)) return
    loadRootThreads({ showLoading: false, preserveOnError: true })
    if (model.status === 'ready')
      for (const project of model.projects)
        loadThreads(project.id, { showLoading: false, preserveOnError: true })
  }

  const connect = (nextRuntime: WorkspaceCatalogRuntime) => {
    runtime = nextRuntime
    if (!runtime.ready) {
      projectRequest?.abort()
      projectRequest = null
      stopThreadRequests()
      unsubscribeEvents?.()
      unsubscribeEvents = null
      return
    }
    unsubscribeEvents?.()
    unsubscribeEvents = dependencies.subscribeToWorkspaceEvents(onWorkspaceEvent)
    loadProjects()
  }

  const disconnect = () => {
    projectRequest?.abort()
    projectRequest = null
    stopThreadRequests()
    unsubscribeEvents?.()
    unsubscribeEvents = null
    runtime = { ...runtime, ready: false }
  }

  const observeActiveThread = (activeThread: WorkspaceCatalogActiveThread) => {
    if (!activeThread) {
      observedThreadState = null
      return
    }
    const key = `${activeThread.projectId ?? '<root>'}:${activeThread.threadId}`
    const previous = observedThreadState
    if (previous?.key === key && previous.busy !== activeThread.isBusy) {
      queueMicrotask(() => {
        if (!runtime.ready) return
        if (activeThread.projectId) loadThreads(activeThread.projectId)
        else loadRootThreads()
      })
    }
    observedThreadState = { key, busy: activeThread.isBusy }
  }

  const actions: WorkspaceCatalogActions = {
    promoteThread: (projectId, threadId) => {
      const scope = projectId ?? '<root>'
      const currentOrder = threadOrder.get(scope) ?? threadIdsForScope(sourceModel, projectId)
      threadOrder.set(scope, [threadId, ...currentOrder.filter((id) => id !== threadId)])
      updateSourceModel((current) => reorderThreadInModel(current, projectId, threadId))
    },
    retryProjects: () => {
      projectRequest?.abort()
      projectRequest = null
      stopThreadRequests()
      updateSourceModel(() => ({ status: 'loading' }))
      loadProjects()
    },
    retryThreads: (projectId) => loadThreads(projectId),
    retryRootThreads: () => loadRootThreads(),
    archiveThread: async (projectId, threadId) => {
      const id = nextOperationId()
      updateOperations((current) => [...current, { id, type: 'archive', projectId, threadId }])
      try {
        await dependencies.threads.archive(projectId, threadId)
        updateSourceModel((current) => removeThread(current, projectId, threadId))
        if (projectId === null)
          loadRootThreads({ showLoading: false, preserveOnError: true, clearOperationId: id })
        else
          loadThreads(projectId, {
            showLoading: false,
            preserveOnError: true,
            clearOperationId: id,
          })
      } catch (error) {
        clearOperation(id)
        throw error
      }
    },
    beginThreadCreation: (projectId, title) => {
      const id = `optimistic-thread-${nextOperationId()}`
      const thread: WorkspaceThread = {
        id,
        title: title.split('\n')[0] || 'New conversation',
        status: 'creating',
        updatedAt: dependencies.now?.() ?? Date.now(),
        isPlaceholder: true,
        canContinue: false,
      }
      updateSourceModel((current) => insertThread(current, projectId, thread))
      return id
    },
    failThreadCreation: (placeholderId, message) => {
      updateSourceModel((current) =>
        mapThread(current, placeholderId, (thread) => ({
          ...thread,
          status: 'systemError',
          errorMessage: message,
          canContinue: false,
        })),
      )
    },
    resolveThreadCreation: (placeholderId, projectId, threadId) => {
      updateSourceModel((current) =>
        mapThread(current, placeholderId, (thread) => ({
          ...thread,
          id: threadId,
          status: 'active',
          isPlaceholder: false,
          canContinue: true,
        })),
      )
      if (projectId === null) loadRootThreads({ showLoading: false, preserveOnError: true })
      else loadThreads(projectId, { showLoading: false, preserveOnError: true })
    },
    deleteThread: async (projectId, threadId) => {
      if (findThread(model, projectId, threadId)?.isPlaceholder) {
        updateSourceModel((current) => removeThread(current, projectId, threadId))
        return
      }
      await dependencies.threads.delete(projectId, threadId)
      updateSourceModel((current) => removeThread(current, projectId, threadId))
    },
    createProject: async (name) => {
      const id = nextOperationId()
      const project: WorkspaceProject = {
        id: `optimistic-project-${id}`,
        name,
        presentationKey: `optimistic-project-${id}`,
        pending: true,
        threads: { status: 'ready', items: [] },
      }
      updateOperations((current) => [...current, { id, type: 'create', project }])
      try {
        const created = await dependencies.projects.create(name)
        updateSourceModel((current) =>
          current.status !== 'ready' ||
          current.projects.some(({ id: projectId }) => projectId === created.id)
            ? current
            : {
                ...current,
                projects: [
                  ...current.projects,
                  {
                    id: created.id,
                    name: created.name,
                    presentationKey: project.presentationKey,
                    threads: { status: 'ready', items: [] },
                  },
                ],
              },
        )
        clearOperation(id)
        return created
      } catch (error) {
        clearOperation(id)
        throw error
      }
    },
    renameProject: async (projectId, name) => {
      const id = nextOperationId()
      updateOperations((current) => [...current, { id, type: 'rename', projectId, name }])
      try {
        const updated = await dependencies.projects.rename(projectId, name)
        updateSourceModel((current) =>
          mapProject(current, projectId, (project) => ({ ...project, name: updated.name })),
        )
        clearOperation(id)
        return updated
      } catch (error) {
        clearOperation(id)
        throw error
      }
    },
    deleteProject: async (projectId) => {
      const id = nextOperationId()
      updateOperations((current) => [...current, { id, type: 'delete', projectId }])
      try {
        await dependencies.projects.delete(projectId)
        threadOrder.delete(projectId)
        updateSourceModel((current) => removeProject(current, projectId))
        clearOperation(id)
        loadRootThreads({ showLoading: false, preserveOnError: true })
      } catch (error) {
        clearOperation(id)
        throw error
      }
    },
  }

  return { actions, getSnapshot, subscribe, connect, disconnect, observeActiveThread }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isCodexUnavailable(error: unknown) {
  const candidate = error as { code?: unknown; status?: unknown }
  return (
    candidate?.code === 'owner.runtime.unavailable' ||
    candidate?.code === 'owner.runtime.start-required' ||
    candidate?.status === 409 ||
    candidate?.status === 502
  )
}
