import { useNavigate } from 'react-router'

import { signOut } from '@/lib/auth/auth-client'
import type { WorkspaceRouteController } from '@/app/composition/routes/use-workspace-route-controller'
import { WorkspaceSidebar } from '@/app/workspace/sidebar/workspace-sidebar'
import type { WorkspaceSidebarController } from '@/app/workspace/sidebar/use-workspace-sidebar-controller'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import type { useWorkspaceOrchestration } from '@/app/workspace/use-workspace-orchestration'
import { SettingsSidebar } from './settings-sidebar'

type WorkspaceNavigationActions = ReturnType<typeof useWorkspaceOrchestration> & {
  startCodex: CodexRuntimeController['start']
}

export function WorkspaceNavigation({
  route,
  runtime,
  controller,
  actions,
}: {
  route: WorkspaceRouteController
  runtime: CodexRuntimeController['model']
  controller: WorkspaceSidebarController
  actions: WorkspaceNavigationActions
}) {
  const navigate = useNavigate()
  const sidebarProps = {
    model: controller.model,
    runtimeStatus: runtime.status,
    onStartCodex: actions.startCodex,
    activeThreadId: route.activeThreadId,
    settingsActive: route.settingsActive,
    newChatActive: route.newChatActive,
    onOpenSettings: route.openSettings,
    onOpenNewChat: () => route.openNewChat(),
    onSignOut: async () => {
      await signOut()
      void navigate('/login', { replace: true })
    },
    onSelectThread: actions.selectThread,
    onSelectRootThread: actions.selectRootThread,
    onRetryProjects: controller.retryProjects,
    onRetryThreads: controller.retryThreads,
    onRetryRootThreads: controller.retryRootThreads,
    onArchiveThread: controller.archiveThread,
    onDeleteThread: controller.deleteThread,
    onOpenProjectChat: route.openNewChat,
    onCreateProject: actions.createProject,
    onRenameProject: actions.renameProject,
    onDeleteProject: actions.deleteProject,
  }
  if (route.settingsActive) {
    return (
      <SettingsSidebar
        archivedActive={route.archivedChatsActive}
        onBack={route.openApp}
        onGeneral={route.openSettings}
        onArchived={route.openArchivedChats}
      />
    )
  }

  return <WorkspaceSidebar {...sidebarProps} />
}
