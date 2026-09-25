import * as React from 'react'

import { useThreadPageController } from '@/app/chat/session/controllers/use-thread-page-controller'
import { ThreadSessionRegistryProvider } from '@/app/chat/session/state/thread-session-store'
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
import type { ComposerRuntimeAdapter } from '@/app/chat/session/adapters/composer-adapter'
import type { ThreadClient } from '@/lib/bridge/thread-client'
import { WorkspaceFrame } from './workspace-frame'
import { useGuestWorkspaceController } from '@/app/workspace/guest/use-guest-workspace-controller'
import { SettingsSidebar } from '@/app/composition/navigation/settings-sidebar'
import { WorkspaceSidebar } from '@/app/workspace/sidebar/workspace-sidebar'

export type WorkspaceProfile = {
  kind: 'owner' | 'guest'
  userId: string
  runtime: CodexRuntimeController
  client?: ThreadClient
  adapter?: ComposerRuntimeAdapter
}

export function WorkspaceShell({
  userId,
  runtime,
  profile,
}: {
  userId: string
  runtime?: CodexRuntimeController
  profile?: Pick<WorkspaceProfile, 'client' | 'adapter' | 'kind'>
}) {
  return (
    <ThreadSessionRegistryProvider userId={userId}>
      {profile?.kind === 'guest' ? (
        <GuestWorkspaceShellContents />
      ) : runtime ? (
        <WorkspaceShellContents userId={userId} runtime={runtime} profile={profile} />
      ) : null}
    </ThreadSessionRegistryProvider>
  )
}

function GuestWorkspaceShellContents() {
  const guest = useGuestWorkspaceController()
  const navigation = guest.settingsActive ? (
    <SettingsSidebar
      archivedActive={false}
      onBack={() => void guest.navigate('/app')}
      onGeneral={() => void guest.navigate('/app/settings')}
      onArchived={() => undefined}
      archivedDisabled
      archivedDisabledMessage={guest.archivedUnavailableMessage}
      showArchived={false}
    />
  ) : (
    <WorkspaceSidebar
      model={guest.sidebarModel}
      runtimeStatus="started"
      runtimeStatusLabel={guest.ready ? 'Guest ready' : 'Connecting'}
      activeThreadId={guest.requestedThreadId}
      settingsActive={false}
      newChatActive={!guest.requestedThreadId}
      onOpenSettings={() => void guest.navigate('/app/settings')}
      onStartCodex={async () => true}
      runtimeInteractive={false}
      isGuest
      onOpenNewChat={() => void guest.navigate('/app')}
      onSelectThread={(_, id) => void guest.navigate(`/app/threads/${encodeURIComponent(id)}`)}
      onSelectRootThread={(id) => void guest.navigate(`/app/threads/${encodeURIComponent(id)}`)}
      onRetryProjects={() => undefined}
      onRetryThreads={() => undefined}
      onRetryRootThreads={() => void guest.refreshThreads()}
      onArchiveThread={async () => undefined}
      onOpenProjectChat={guest.unavailable}
      onCreateProject={async () => guest.unavailable()}
      onRenameProject={async () => guest.unavailable()}
      onDeleteProject={async () => guest.unavailable()}
      projectAccess="unavailable"
      projectUnavailableMessage={guest.projectUnavailableMessage}
      archiveAvailable={false}
      persistUiState={false}
    />
  )
  return (
    <WorkspaceFrame navigation={navigation}>
      <WorkspacePageContent guest={guest} />
    </WorkspaceFrame>
  )
}

function WorkspaceShellContents({
  userId,
  runtime,
  profile,
}: {
  userId: string
  runtime: CodexRuntimeController
  profile?: Pick<WorkspaceProfile, 'client' | 'adapter' | 'kind'>
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
    client: profile?.client,
    adapter: profile?.adapter,
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
    <WorkspaceFrame
      navigation={
        <WorkspaceNavigation
          route={route}
          runtime={runtime.model}
          controller={controller}
          actions={{ ...orchestration, startCodex: runtime.start }}
        />
      }
    >
      <WorkspacePageContent
        route={route}
        runtime={runtime}
        page={page}
        controller={controller}
        orchestration={orchestration}
        selectedNewChatProjectId={selectedNewChatProjectId}
      />
    </WorkspaceFrame>
  )
}
