import { useLocation, useNavigate } from 'react-router'
import * as React from 'react'
import { PanelLeft } from 'lucide-react'

import { signOut } from '@/lib/auth/auth-client'
import type { WorkspaceRouteController } from '@/app/composition/routes/use-workspace-route-controller'
import { WorkspaceSidebar } from '@/app/workspace/sidebar/workspace-sidebar'
import type { WorkspaceSidebarController } from '@/app/workspace/sidebar/use-workspace-sidebar-controller'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import type { useWorkspaceOrchestration } from '@/app/workspace/use-workspace-orchestration'
import { SettingsSidebar } from './settings-sidebar'
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { MobileNavigationCloseProvider } from './mobile-navigation-context'

type WorkspaceNavigationActions = ReturnType<typeof useWorkspaceOrchestration> & {
  startCodex: CodexRuntimeController['start']
}

export function MobileWorkspaceNavigation({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const location = useLocation()
  const locationRef = React.useRef(`${location.pathname}${location.search}${location.hash}`)
  const locationKey = `${location.pathname}${location.search}${location.hash}`

  React.useEffect(() => {
    if (locationRef.current === locationKey) return
    locationRef.current = locationKey
    if (open) setOpen(false)
  }, [locationKey, open])

  React.useEffect(() => {
    if (!open) return
    const onPopState = () => setOpen(false)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (window.history.state?.mobileNavigation) window.history.back()
    }
  }, [open])
  React.useEffect(() => {
    if (!open) return
    window.history.pushState({ mobileNavigation: true }, '')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])
  return (
    <>
      <aside className="hidden w-78 shrink-0 self-stretch xl:block">{children}</aside>
      <div className="mobile-nav-trigger fixed top-2 left-3 z-30 xl:hidden">
        <Drawer open={open} onOpenChange={setOpen} swipeDirection="left">
          <DrawerTrigger
            render={
              <Button variant="ghost" aria-label="Open navigation" className="size-10">
                <PanelLeft className="size-5 text-app-text-muted" />
              </Button>
            }
          />
          <DrawerContent className="max-w-none bg-sidebar text-sidebar-foreground [--drawer-content-width:17rem]">
            <DrawerTitle className="sr-only">Workspace navigation</DrawerTitle>
            <div className="h-svh max-h-svh pt-[env(safe-area-inset-top)]">
              <MobileNavigationCloseProvider close={() => setOpen(false)}>
                {children}
              </MobileNavigationCloseProvider>
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    </>
  )
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
  const content = route.settingsActive ? (
    <SettingsSidebar
      archivedActive={route.archivedChatsActive}
      onBack={route.openApp}
      onGeneral={route.openSettings}
      onArchived={route.openArchivedChats}
    />
  ) : (
    <WorkspaceSidebar {...sidebarProps} />
  )

  return <MobileWorkspaceNavigation>{content}</MobileWorkspaceNavigation>
}
