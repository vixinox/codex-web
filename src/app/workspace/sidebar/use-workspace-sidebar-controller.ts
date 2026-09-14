import * as React from 'react'

import {
  createProject as requestCreateProject,
  deleteProject as requestDeleteProject,
  fetchProjects,
  renameProject as requestRenameProject,
  type ProjectSummary,
} from '@/lib/bridge/http/projects'
import {
  archiveThread as requestArchiveThread,
  deleteThread as requestDeleteThread,
  fetchThreads,
} from '@/lib/bridge/http/threads'
import { subscribeToEvents } from '@/lib/bridge/events/event-source'
import type {
  WorkspaceProject,
  WorkspaceSidebarModel,
  WorkspaceThread,
} from '@/app/workspace/model/types'
import type { WorkspaceRuntimeModel } from '@/app/workspace/runtime/use-codex-runtime-controller'

type WorkspaceSidebarRuntimeSource = {
  model: WorkspaceRuntimeModel
  reportUnavailable: () => void
}

export type WorkspaceSidebarActiveThread = {
  projectId: string | null
  threadId: string
  isBusy: boolean
} | null

export type WorkspaceSidebarController = {
  model: WorkspaceSidebarModel
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

type OptimisticOperation =
  | { id: number; type: 'create'; project: WorkspaceProject }
  | { id: number; type: 'rename'; projectId: string; name: string }
  | { id: number; type: 'delete'; projectId: string }
  | { id: number; type: 'archive'; projectId: string | null; threadId: string }

type LoadOptions = {
  showLoading?: boolean
  preserveOnError?: boolean
  clearOperationId?: number
}

export function useWorkspaceSidebarController(
  runtimeSource: WorkspaceSidebarRuntimeSource,
  activeThread: WorkspaceSidebarActiveThread = null,
): WorkspaceSidebarController {
  const runtime = React.useMemo(
    () => ({
      ready: runtimeSource.model.status === 'started',
      status: runtimeSource.model.status,
      message: runtimeSource.model.status === 'error' ? runtimeSource.model.message : undefined,
      onUnavailable: runtimeSource.reportUnavailable,
    }),
    [runtimeSource.model, runtimeSource.reportUnavailable],
  )
  const [sourceModel, setSourceModel] = React.useState<WorkspaceSidebarModel>({
    status: 'loading',
  })
  const [operations, setOperations] = React.useState<readonly OptimisticOperation[]>([])
  const [projectRetryKey, setProjectRetryKey] = React.useState(0)
  const projectRequest = React.useRef<AbortController | null>(null)
  const threadRequests = React.useRef(new Map<string, AbortController>())
  const rootRequest = React.useRef<AbortController | null>(null)
  const threadOrder = React.useRef(new Map<string, readonly string[]>())
  const operationSequence = React.useRef(0)
  const model = React.useMemo(
    () => applyOptimisticOperations(sourceModel, operations),
    [operations, sourceModel],
  )
  const modelRef = React.useRef(model)
  React.useEffect(() => {
    modelRef.current = model
  }, [model])

  const activeThreadKey = activeThread
    ? `${activeThread.projectId ?? '<root>'}:${activeThread.threadId}`
    : null
  const activeThreadProjectId = activeThread?.projectId
  const activeThreadBusy = activeThread?.isBusy
  const observedThreadState = React.useRef<{ key: string; busy: boolean } | null>(null)
  const nextOperationId = () => {
    operationSequence.current += 1
    return operationSequence.current
  }
  const clearOperation = (id: number) => {
    setOperations((current) => current.filter((operation) => operation.id !== id))
  }

  const loadRootThreads = React.useCallback(
    (options: LoadOptions = {}) => {
      if (!runtime.ready) return
      const showLoading = options.showLoading ?? true
      rootRequest.current?.abort()
      const controller = new AbortController()
      rootRequest.current = controller
      if (showLoading) {
        setSourceModel((current) =>
          current.status === 'ready' ? { ...current, rootThreads: { status: 'loading' } } : current,
        )
      }
      void fetchThreads(null, controller.signal)
        .then((items) => {
          if (rootRequest.current !== controller) return undefined
          setSourceModel((current) =>
            current.status === 'ready'
              ? {
                  ...current,
                  rootThreads: {
                    status: 'ready',
                    items: reconcileThreadOrder(
                      mapRootThreads(items),
                      '<root>',
                      threadOrder.current,
                    ),
                  },
                }
              : current,
          )
          if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
          return undefined
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          if (isCodexUnavailable(error)) runtime.onUnavailable()
          if (options.preserveOnError) {
            if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
            return
          }
          setSourceModel((current) =>
            current.status === 'ready'
              ? {
                  ...current,
                  rootThreads: {
                    status: 'error',
                    message:
                      error instanceof Error ? error.message : 'Could not load threads. Try again.',
                  },
                }
              : current,
          )
        })
        .finally(() => {
          if (rootRequest.current === controller) rootRequest.current = null
        })
    },
    [runtime],
  )

  const loadThreads = React.useCallback(
    (projectId: string, options: LoadOptions = {}) => {
      if (!runtime.ready) return
      const showLoading = options.showLoading ?? true
      threadRequests.current.get(projectId)?.abort()
      const controller = new AbortController()
      threadRequests.current.set(projectId, controller)
      if (showLoading) {
        setSourceModel((current) =>
          mapProject(current, projectId, (project) => ({
            ...project,
            threads: { status: 'loading' },
          })),
        )
      }

      void fetchThreads(projectId, controller.signal)
        .then((items) => {
          if (threadRequests.current.get(projectId) !== controller) return undefined
          setSourceModel((current) =>
            mapProject(current, projectId, (project) => ({
              ...project,
              threads: {
                status: 'ready',
                items: reconcileThreadOrder(
                  mapProjectThreads(items, project.name),
                  projectId,
                  threadOrder.current,
                ),
              },
            })),
          )
          if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
          return undefined
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          if (isCodexUnavailable(error)) runtime.onUnavailable()
          if (options.preserveOnError) {
            if (options.clearOperationId !== undefined) clearOperation(options.clearOperationId)
            return
          }
          setSourceModel((current) =>
            mapProject(current, projectId, (project) => ({
              ...project,
              threads: {
                status: 'error',
                message:
                  error instanceof Error ? error.message : 'Could not load threads. Try again.',
              },
            })),
          )
        })
        .finally(() => {
          if (threadRequests.current.get(projectId) === controller) {
            threadRequests.current.delete(projectId)
          }
        })
    },
    [runtime],
  )

  const stopThreadRequests = React.useCallback(() => {
    rootRequest.current?.abort()
    rootRequest.current = null
    for (const request of threadRequests.current.values()) request.abort()
    threadRequests.current.clear()
  }, [])

  React.useEffect(() => {
    if (!runtime.ready) {
      projectRequest.current?.abort()
      projectRequest.current = null
      stopThreadRequests()
      return
    }
    projectRequest.current?.abort()
    const controller = new AbortController()
    projectRequest.current = controller
    queueMicrotask(() => {
      if (projectRequest.current === controller) setSourceModel({ status: 'loading' })
    })
    void fetchProjects(controller.signal)
      .then((projects) => {
        if (projectRequest.current !== controller) return undefined
        const nextProjects: WorkspaceProject[] = projects.map(({ id, name }) => ({
          id,
          name,
          threads: { status: 'loading' },
        }))
        setSourceModel({
          status: 'ready',
          rootThreads: { status: 'loading' },
          projects: nextProjects,
        })
        loadRootThreads()
        for (const project of nextProjects) loadThreads(project.id)
        return undefined
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (projectRequest.current !== controller) return
        if (isCodexUnavailable(error)) runtime.onUnavailable()
        setSourceModel({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load projects. Try again.',
        })
      })
      .finally(() => {
        if (projectRequest.current === controller) projectRequest.current = null
      })
    return () => {
      controller.abort()
      if (projectRequest.current === controller) projectRequest.current = null
      stopThreadRequests()
    }
  }, [loadRootThreads, loadThreads, projectRetryKey, runtime, stopThreadRequests])

  React.useEffect(() => {
    if (!activeThreadKey || activeThreadBusy === undefined) {
      observedThreadState.current = null
      return
    }

    const previous = observedThreadState.current
    if (previous?.key === activeThreadKey && previous.busy !== activeThreadBusy) {
      queueMicrotask(() => {
        if (activeThreadProjectId) loadThreads(activeThreadProjectId)
        else loadRootThreads()
      })
    }
    observedThreadState.current = { key: activeThreadKey, busy: activeThreadBusy }
  }, [activeThreadBusy, activeThreadKey, activeThreadProjectId, loadRootThreads, loadThreads])

  React.useEffect(() => {
    const receive = (event: Event) => {
      const method = event.type
      if (
        !['thread/archived', 'thread/unarchived', 'thread/closed', 'thread/deleted'].includes(
          method,
        )
      )
        return
      loadRootThreads({ showLoading: false, preserveOnError: true })
      if (modelRef.current.status === 'ready')
        for (const project of modelRef.current.projects)
          loadThreads(project.id, { showLoading: false, preserveOnError: true })
    }
    if (!runtime.ready) return
    return subscribeToEvents({
      url: '/api/events?scope=workspace',
      events: ['thread/archived', 'thread/unarchived', 'thread/closed', 'thread/deleted'],
      onEvent: receive,
    })
  }, [loadRootThreads, loadThreads, runtime.ready])

  return {
    model,
    promoteThread: (projectId, threadId) => {
      const scope = projectId ?? '<root>'
      const currentOrder =
        threadOrder.current.get(scope) ?? threadIdsForScope(sourceModel, projectId)
      const nextOrder = [threadId, ...currentOrder.filter((id) => id !== threadId)]
      threadOrder.current.set(scope, nextOrder)
      setSourceModel((current) => reorderThreadInModel(current, projectId, threadId))
    },
    retryProjects: () => {
      projectRequest.current?.abort()
      projectRequest.current = null
      stopThreadRequests()
      setSourceModel({ status: 'loading' })
      setProjectRetryKey((value) => value + 1)
    },
    retryThreads: loadThreads,
    retryRootThreads: loadRootThreads,
    archiveThread: async (projectId, threadId) => {
      const id = nextOperationId()
      setOperations((current) => [...current, { id, type: 'archive', projectId, threadId }])
      try {
        await requestArchiveThread(projectId, threadId)
        setSourceModel((current) => removeThread(current, projectId, threadId))
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
        updatedAt: Date.now(),
        isPlaceholder: true,
        canContinue: false,
      }
      setSourceModel((current) => insertThread(current, projectId, thread))
      return id
    },
    failThreadCreation: (placeholderId, message) => {
      setSourceModel((current) =>
        mapThread(current, placeholderId, (thread) => ({
          ...thread,
          status: 'systemError',
          errorMessage: message,
          canContinue: false,
        })),
      )
    },
    resolveThreadCreation: (placeholderId, projectId, threadId) => {
      setSourceModel((current) =>
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
      const thread = findThread(modelRef.current, projectId, threadId)
      if (thread?.isPlaceholder) {
        setSourceModel((current) => removeThread(current, projectId, threadId))
        return
      }
      await requestDeleteThread(projectId, threadId)
      setSourceModel((current) => removeThread(current, projectId, threadId))
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
      setOperations((current) => [...current, { id, type: 'create', project }])
      try {
        const created = await requestCreateProject(name)
        setSourceModel((current) =>
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
      setOperations((current) => [...current, { id, type: 'rename', projectId, name }])
      try {
        const updated = await requestRenameProject(projectId, name)
        setSourceModel((current) =>
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
      setOperations((current) => [...current, { id, type: 'delete', projectId }])
      try {
        await requestDeleteProject(projectId)
        threadOrder.current.delete(projectId)
        setSourceModel((current) => removeProject(current, projectId))
        clearOperation(id)
        loadRootThreads({ showLoading: false, preserveOnError: true })
      } catch (error) {
        clearOperation(id)
        throw error
      }
    },
  }
}

function applyOptimisticOperations(
  sourceModel: WorkspaceSidebarModel,
  operations: readonly OptimisticOperation[],
): WorkspaceSidebarModel {
  return operations.reduce<WorkspaceSidebarModel>((model, operation) => {
    if (model.status !== 'ready') return model
    switch (operation.type) {
      case 'create':
        return model.projects.some(({ id }) => id === operation.project.id)
          ? model
          : Object.assign({}, model, { projects: [...model.projects, operation.project] })
      case 'rename':
        return mapProject(model, operation.projectId, (project) => ({
          ...project,
          name: operation.name,
          pending: true,
        }))
      case 'delete':
        return removeProject(model, operation.projectId)
      case 'archive':
        return removeThread(model, operation.projectId, operation.threadId)
    }
  }, sourceModel)
}

function insertThread(
  model: WorkspaceSidebarModel,
  projectId: string | null,
  thread: WorkspaceThread,
): WorkspaceSidebarModel {
  if (model.status !== 'ready') return model
  if (projectId === null)
    return {
      ...model,
      rootThreads:
        model.rootThreads.status === 'ready'
          ? { ...model.rootThreads, items: [thread, ...model.rootThreads.items] }
          : model.rootThreads,
    }
  return mapProject(model, projectId, (project) => ({
    ...project,
    threads:
      project.threads.status === 'ready'
        ? { ...project.threads, items: [thread, ...project.threads.items] }
        : project.threads,
  }))
}
function mapThread(
  model: WorkspaceSidebarModel,
  id: string,
  fn: (thread: WorkspaceThread) => WorkspaceThread,
): WorkspaceSidebarModel {
  if (model.status !== 'ready') return model
  return {
    ...model,
    rootThreads:
      model.rootThreads.status === 'ready'
        ? {
            ...model.rootThreads,
            items: model.rootThreads.items.map((t) => (t.id === id ? fn(t) : t)),
          }
        : model.rootThreads,
    projects: model.projects.map((p) => ({
      ...p,
      threads:
        p.threads.status === 'ready'
          ? { ...p.threads, items: p.threads.items.map((t) => (t.id === id ? fn(t) : t)) }
          : p.threads,
    })),
  }
}
function findThread(model: WorkspaceSidebarModel, projectId: string | null, id: string) {
  if (model.status !== 'ready') return undefined
  if (projectId === null)
    return model.rootThreads.status === 'ready'
      ? model.rootThreads.items.find((t) => t.id === id)
      : undefined
  const project = model.projects.find((p) => p.id === projectId)
  return project?.threads.status === 'ready'
    ? project.threads.items.find((t) => t.id === id)
    : undefined
}

function mapRootThreads(
  items: readonly {
    id: string
    title: string
    status: WorkspaceThread['status']
    updatedAt: number
  }[],
) {
  return items.map(({ id, title, status, updatedAt }) => ({
    id,
    title,
    status,
    updatedAt,
    sourceLabel: 'Workspace',
  }))
}

function mapProjectThreads(
  items: readonly {
    id: string
    title: string
    status: WorkspaceThread['status']
    updatedAt: number
  }[],
  projectName: string,
) {
  return items.map(({ id, title, status, updatedAt }) => ({
    id,
    title,
    status,
    updatedAt,
    sourceLabel: projectName,
  }))
}

function reconcileThreadOrder(
  items: readonly WorkspaceThread[],
  scope: string,
  threadOrder: Map<string, readonly string[]>,
): readonly WorkspaceThread[] {
  const incomingIds = items.map(({ id }) => id)
  const previousOrder = threadOrder.get(scope)
  if (!previousOrder) {
    threadOrder.set(scope, incomingIds)
    return items
  }
  const incomingSet = new Set(incomingIds)
  const nextOrder = previousOrder.filter((id) => incomingSet.has(id))
  const knownIds = new Set(nextOrder)
  for (const [index, id] of incomingIds.entries()) {
    if (knownIds.has(id)) continue
    const precedingKnownId = incomingIds
      .slice(0, index)
      .reverse()
      .find((candidate) => knownIds.has(candidate))
    const insertionIndex = precedingKnownId ? nextOrder.indexOf(precedingKnownId) + 1 : 0
    nextOrder.splice(insertionIndex, 0, id)
    knownIds.add(id)
  }
  threadOrder.set(scope, nextOrder)
  const byId = new Map(items.map((thread) => [thread.id, thread]))
  return nextOrder.flatMap((id) => {
    const thread = byId.get(id)
    return thread ? [thread] : []
  })
}

function reorderThreadInModel(
  model: WorkspaceSidebarModel,
  projectId: string | null,
  threadId: string,
): WorkspaceSidebarModel {
  const promote = (items: readonly WorkspaceThread[]) => {
    const target = items.find((thread) => thread.id === threadId)
    return target ? [target, ...items.filter((thread) => thread.id !== threadId)] : items
  }
  if (model.status !== 'ready') return model
  if (projectId === null) {
    return model.rootThreads.status !== 'ready'
      ? model
      : {
          ...model,
          rootThreads: { ...model.rootThreads, items: promote(model.rootThreads.items) },
        }
  }
  return mapProject(model, projectId, (project) =>
    project.threads.status !== 'ready'
      ? project
      : { ...project, threads: { ...project.threads, items: promote(project.threads.items) } },
  )
}

function threadIdsForScope(
  model: WorkspaceSidebarModel,
  projectId: string | null,
): readonly string[] {
  if (model.status !== 'ready') return []
  if (projectId === null)
    return model.rootThreads.status === 'ready' ? model.rootThreads.items.map(({ id }) => id) : []
  const project = model.projects.find(({ id }) => id === projectId)
  return project?.threads.status === 'ready' ? project.threads.items.map(({ id }) => id) : []
}

function isCodexUnavailable(error: unknown) {
  const candidate = error as { code?: unknown; status?: unknown }
  return candidate?.code === 'CODEX_UNAVAILABLE' || candidate?.status === 502
}

function mapProject(
  model: WorkspaceSidebarModel,
  projectId: string,
  update: (project: WorkspaceProject) => WorkspaceProject,
): WorkspaceSidebarModel {
  if (model.status !== 'ready') return model
  return {
    ...model,
    projects: model.projects.map((project) =>
      project.id === projectId ? update(project) : project,
    ),
  }
}

function removeProject(model: WorkspaceSidebarModel, projectId: string): WorkspaceSidebarModel {
  if (model.status !== 'ready') return model
  return { ...model, projects: model.projects.filter((project) => project.id !== projectId) }
}

function removeThread(
  model: WorkspaceSidebarModel,
  projectId: string | null,
  threadId: string,
): WorkspaceSidebarModel {
  if (model.status !== 'ready') return model
  if (projectId === null) {
    return model.rootThreads.status !== 'ready'
      ? model
      : {
          ...model,
          rootThreads: {
            ...model.rootThreads,
            items: model.rootThreads.items.filter((thread) => thread.id !== threadId),
          },
        }
  }
  return mapProject(model, projectId, (project) =>
    project.threads.status !== 'ready'
      ? project
      : {
          ...project,
          threads: {
            ...project.threads,
            items: project.threads.items.filter((thread) => thread.id !== threadId),
          },
        },
  )
}
