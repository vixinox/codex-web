import * as React from 'react'

import { useThreadPageController } from '@/app/chat/session/use-thread-page-controller'
import { ThreadSessionRegistryProvider } from '@/app/chat/session/thread-session-store'
import { WorkspaceNavigation } from '@/app/composition/navigation/workspace-navigation'
import {
  useWorkspaceProjectRouteValidation,
  useWorkspaceRouteController,
} from '@/app/composition/routes/use-workspace-route-controller'
import { WorkspacePageContent } from '@/app/composition/workspace-page-content'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import {
  useWorkspaceSidebarController,
  type WorkspaceSidebarController,
} from '@/app/workspace/sidebar/use-workspace-sidebar-controller'
import { useWorkspaceOrchestration } from '@/app/workspace/use-workspace-orchestration'

export function WorkspaceShell({
  userId,
  runtime,
}: {
  userId: string
  runtime: CodexRuntimeController
}) {
  return (
    <ThreadSessionRegistryProvider userId={userId}>
      <WorkspaceShellContents userId={userId} runtime={runtime} />
    </ThreadSessionRegistryProvider>
  )
}

function WorkspaceShellContents({
  userId,
  runtime,
}: {
  userId: string
  runtime: CodexRuntimeController
}) {
  const route = useWorkspaceRouteController()
  const controllerRef = React.useRef<WorkspaceSidebarController | null>(null)
  const orchestration = useWorkspaceOrchestration(controllerRef, route)
  const page = useThreadPageController({
    userId,
    target: route.pageTarget ?? {
      projectId: route.selection?.projectId ?? route.requestedProjectId,
      threadId: route.activeThreadId,
    },
    runtimeReady: runtime.model.status === 'started',
    runtimeStatus: runtime.model.status,
    onNavigateToThread: orchestration.onNavigateToThread,
    onTurnAccepted: orchestration.onTurnAccepted,
    onUnavailable: runtime.reportUnavailable,
    onThreadLifecycle: route.handleThreadLifecycle,
    onThreadCreationStart: (projectId, title) =>
      controllerRef.current?.beginThreadCreation(projectId, title) ?? '',
    onThreadCreationFailed: (id, message) => controllerRef.current?.failThreadCreation(id, message),
    onThreadCreationResolved: (id, projectId, threadId) =>
      controllerRef.current?.resolveThreadCreation(id, projectId, threadId),
  })
  const activeThread =
    route.selection && page.model.status === 'ready'
      ? {
          projectId: route.selection.projectId,
          threadId: route.selection.threadId,
          isBusy: page.model.thread.isBusy,
        }
      : null
  const controller = useWorkspaceSidebarController(runtime, activeThread)
  React.useEffect(() => {
    controllerRef.current = controller
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [controller])
  const projectIds =
    controller.model.status === 'ready'
      ? controller.model.projects.map((project) => project.id)
      : null
  const selectedNewChatProjectId = useWorkspaceProjectRouteValidation(route, projectIds)

  return (
    <div className="relative flex h-svh w-full bg-sidebar">
      <WorkspaceNavigation
        route={route}
        runtime={runtime.model}
        controller={controller}
        actions={{ ...orchestration, startCodex: runtime.start }}
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col rounded-tl-3xl border bg-app-surface">
        <WorkspacePageContent
          route={route}
          runtime={runtime}
          page={page}
          controller={controller}
          orchestration={orchestration}
          selectedNewChatProjectId={selectedNewChatProjectId}
        />
      </main>
    </div>
  )
}
