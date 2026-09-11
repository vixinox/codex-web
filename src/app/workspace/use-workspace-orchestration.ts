import * as React from 'react'

import type { WorkspaceRouteController } from '@/app/composition/routes/use-workspace-route-controller'
import type { WorkspaceSidebarController } from './sidebar/use-workspace-sidebar-controller'

type StartedThread = { projectId: string | null; threadId: string; turnId: string }

export function useWorkspaceOrchestration(
  controllerRef: React.RefObject<WorkspaceSidebarController | null>,
  route: WorkspaceRouteController,
) {
  const onNavigateToThread = React.useCallback(
    (started: StartedThread) => {
      const controller = requireController(controllerRef)
      if (started.projectId) controller.retryThreads(started.projectId)
      else controller.retryRootThreads()
      route.navigateToThread(started.projectId, started.threadId)
    },
    [controllerRef, route],
  )
  const onTurnAccepted = React.useCallback(
    (turn: StartedThread) => {
      requireController(controllerRef).promoteThread(turn.projectId, turn.threadId)
    },
    [controllerRef],
  )
  const createProject = React.useCallback(
    async (name: string) => {
      const created = await requireController(controllerRef).createProject(name)
      route.openNewChat(created.id)
    },
    [controllerRef, route],
  )
  const renameProject = React.useCallback(
    async (projectId: string, name: string) => {
      await requireController(controllerRef).renameProject(projectId, name)
    },
    [controllerRef],
  )
  const deleteProject = React.useCallback(
    async (projectId: string) => {
      await requireController(controllerRef).deleteProject(projectId)
      if (route.requestedProjectId === projectId || route.selection?.projectId === projectId)
        route.openNewChat()
    },
    [controllerRef, route],
  )
  const selectThread = React.useCallback(
    (projectId: string, threadId: string) => route.navigateToThread(projectId, threadId),
    [route],
  )
  const selectRootThread = React.useCallback(
    (threadId: string) => route.navigateToThread(null, threadId),
    [route],
  )

  return {
    onNavigateToThread,
    onTurnAccepted,
    createProject,
    renameProject,
    deleteProject,
    selectThread,
    selectRootThread,
  }
}

function requireController(ref: React.RefObject<WorkspaceSidebarController | null>) {
  if (!ref.current) throw new Error('Workspace sidebar controller is not ready.')
  return ref.current
}
