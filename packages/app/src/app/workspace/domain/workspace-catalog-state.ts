import type {
  WorkspaceProject,
  WorkspaceSidebarModel,
  WorkspaceThread,
} from '@/app/workspace/workspace-model'

export type OptimisticOperation =
  | { id: number; type: 'create'; project: WorkspaceProject }
  | { id: number; type: 'rename'; projectId: string; name: string }
  | { id: number; type: 'delete'; projectId: string }
  | { id: number; type: 'archive'; projectId: string | null; threadId: string }

export type CatalogThreadSummary = {
  id: string
  title: string
  status: WorkspaceThread['status']
  updatedAt: number
}

export function applyOptimisticOperations(
  sourceModel: WorkspaceSidebarModel,
  operations: readonly OptimisticOperation[],
): WorkspaceSidebarModel {
  return operations.reduce<WorkspaceSidebarModel>((model, operation) => {
    if (model.status !== 'ready') return model
    switch (operation.type) {
      case 'create':
        return model.projects.some(({ id }) => id === operation.project.id)
          ? model
          : { ...model, projects: [...model.projects, operation.project] }
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

export function insertThread(
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

export function mapThread(
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
            items: model.rootThreads.items.map((thread) =>
              thread.id === id ? fn(thread) : thread,
            ),
          }
        : model.rootThreads,
    projects: model.projects.map((project) => ({
      ...project,
      threads:
        project.threads.status === 'ready'
          ? {
              ...project.threads,
              items: project.threads.items.map((thread) =>
                thread.id === id ? fn(thread) : thread,
              ),
            }
          : project.threads,
    })),
  }
}

export function findThread(
  model: WorkspaceSidebarModel,
  projectId: string | null,
  id: string,
): WorkspaceThread | undefined {
  if (model.status !== 'ready') return undefined
  if (projectId === null)
    return model.rootThreads.status === 'ready'
      ? model.rootThreads.items.find((thread) => thread.id === id)
      : undefined
  const project = model.projects.find((candidate) => candidate.id === projectId)
  return project?.threads.status === 'ready'
    ? project.threads.items.find((thread) => thread.id === id)
    : undefined
}

export function mapRootThreads(items: readonly CatalogThreadSummary[]): readonly WorkspaceThread[] {
  return items.map(({ id, title, status, updatedAt }) => ({
    id,
    title,
    status,
    updatedAt,
    sourceLabel: 'Workspace',
  }))
}

export function mapProjectThreads(
  items: readonly CatalogThreadSummary[],
  projectName: string,
): readonly WorkspaceThread[] {
  return items.map(({ id, title, status, updatedAt }) => ({
    id,
    title,
    status,
    updatedAt,
    sourceLabel: projectName,
  }))
}

export function reconcileThreadOrder(
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

export function reorderThreadInModel(
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

export function threadIdsForScope(
  model: WorkspaceSidebarModel,
  projectId: string | null,
): readonly string[] {
  if (model.status !== 'ready') return []
  if (projectId === null)
    return model.rootThreads.status === 'ready' ? model.rootThreads.items.map(({ id }) => id) : []
  const project = model.projects.find(({ id }) => id === projectId)
  return project?.threads.status === 'ready' ? project.threads.items.map(({ id }) => id) : []
}

export function mapProject(
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

export function removeProject(
  model: WorkspaceSidebarModel,
  projectId: string,
): WorkspaceSidebarModel {
  if (model.status !== 'ready') return model
  return { ...model, projects: model.projects.filter((project) => project.id !== projectId) }
}

export function removeThread(
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
