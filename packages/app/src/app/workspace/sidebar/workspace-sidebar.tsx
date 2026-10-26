import * as React from 'react'
import { ChevronRight, Dot, LogOut, Plus, Settings, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useCanHover } from '@/lib/platform/browser/use-can-hover'
import type { WorkspaceSidebarModel } from '@/app/workspace/workspace-model'
import type { WorkspaceRuntimeModel } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { useNativeFadeEnter } from '@/lib/platform/browser/use-native-enter'
import { ProjectNameDialog } from '../project-name-dialog'
import { LoadError, ProjectItem, ThreadItem } from './sidebar-items'
import { useStoredBoolean } from './sidebar-storage'
import {
  clampWorkspaceSidebarWidth,
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  MIN_WORKSPACE_SIDEBAR_WIDTH,
} from './sidebar-storage'
import { Spinner } from '@/components/ui/spinner'
import { FadePresenceList } from './fade-presence-list'
import {
  useIsMobileNavigation,
  useMobileNavigationClose,
} from '@/app/composition/navigation/mobile-navigation-context'

export function WorkspaceSidebar({
  model,
  runtimeStatus,
  activeThreadId,
  settingsActive,
  onOpenSettings,
  onStartCodex,
  onSignOut,
  onOpenNewChat,
  onSelectThread,
  onSelectRootThread,
  onRetryProjects,
  onRetryThreads,
  onRetryRootThreads,
  onArchiveThread,
  onDeleteThread,
  onOpenProjectChat,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  archiveAvailable = true,
  runtimeStatusLabel,
  runtimeInteractive = true,
  persistUiState = true,
  sidebarWidth,
  onSidebarWidthChange,
}: {
  model: WorkspaceSidebarModel
  runtimeStatus: WorkspaceRuntimeModel['status']
  activeThreadId: string | null
  settingsActive: boolean
  newChatActive: boolean
  onOpenSettings: () => void
  onStartCodex: () => Promise<boolean>
  onSignOut?: () => Promise<void>
  onOpenNewChat: () => void
  onSelectThread: (projectId: string, threadId: string) => void
  onSelectRootThread: (threadId: string) => void
  onRetryProjects: () => void
  onRetryThreads: (projectId: string) => void
  onRetryRootThreads: () => void
  onArchiveThread: (projectId: string | null, threadId: string) => Promise<void>
  onDeleteThread?: (projectId: string | null, threadId: string) => Promise<void>
  onOpenProjectChat: (projectId: string) => void
  onCreateProject: (name: string) => Promise<void>
  onRenameProject: (projectId: string, name: string) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  archiveAvailable?: boolean
  runtimeStatusLabel?: string
  runtimeInteractive?: boolean
  /** Fixture workspaces keep collapse state in memory rather than local storage. */
  persistUiState?: boolean
  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
}) {
  const canHover = useCanHover()
  const closeMobileNavigation = useMobileNavigationClose()
  const isDrawerMode = useIsMobileNavigation()
  const sidebarRef = useNativeFadeEnter<HTMLElement>([settingsActive], {
    duration: 0.22,
  })
  const [createOpen, setCreateOpen] = React.useState(false)
  const [projectsOpen, setProjectsOpen] = useStoredBoolean(
    'workspace-sidebar:projects',
    true,
    persistUiState,
  )
  const [threadsOpen, setThreadsOpen] = useStoredBoolean(
    'workspace-sidebar:threads',
    true,
    persistUiState,
  )
  const resizeRef = React.useRef<{ startX: number; startWidth: number } | null>(null)
  const stopResizing = React.useCallback(() => {
    resizeRef.current = null
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }, [])
  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) return
      onSidebarWidthChange(
        clampWorkspaceSidebarWidth(
          resizeRef.current.startWidth + event.clientX - resizeRef.current.startX,
        ),
      )
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      stopResizing()
    }
  }, [onSidebarWidthChange, stopResizing])
  const startResizing = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.matchMedia('(max-width: 1279px)').matches) return
    event.preventDefault()
    resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onSidebarWidthChange(clampWorkspaceSidebarWidth(sidebarWidth - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onSidebarWidthChange(clampWorkspaceSidebarWidth(sidebarWidth + step))
    }
  }
  const runtimeLabel =
    runtimeStatus === 'started'
      ? 'Started'
      : runtimeStatus === 'starting'
        ? 'Starting'
        : runtimeStatus === 'stopped'
          ? 'Stopped'
          : 'Error'
  const displayRuntimeLabel = runtimeStatusLabel ?? runtimeLabel
  const openNewChat = () => {
    onOpenNewChat()
    closeMobileNavigation?.()
  }
  const runtimeContent = (
    <>
      {runtimeStatus === 'started' ? (
        <Dot className="size-4 text-success" strokeWidth="6" />
      ) : runtimeStatus === 'error' ? (
        <XCircle data-icon="inline-start" className="text-destructive" />
      ) : runtimeStatus === 'starting' ? (
        <Spinner />
      ) : (
        <Dot data-icon="inline-start" className="text-muted-foreground" strokeWidth="6" />
      )}
      <span>{displayRuntimeLabel}</span>
    </>
  )
  return (
    <>
      <aside
        ref={sidebarRef}
        className="relative flex h-full min-h-0 w-full min-w-0 flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground xl:w-(--workspace-sidebar-width) xl:shrink-0"
        style={{ '--workspace-sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={MIN_WORKSPACE_SIDEBAR_WIDTH}
          aria-valuemax={MAX_WORKSPACE_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          className="group/resize absolute top-0 -right-0.75 z-20 hidden h-full w-1 cursor-col-resize touch-none xl:block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring before:absolute before:top-0 before:left-1/2 before:h-full before:w-px before:-translate-x-1/2 before:bg-ring/0 before:transition-colors hover:before:bg-ring/70 focus-visible:before:bg-ring/70 [&:active]:before:bg-ring"
          onPointerDown={startResizing}
          onKeyDown={resizeWithKeyboard}
        />
        <div className="flex flex-col pt-3 pb-2">
          <button
            type="button"
            className="py-1 pb-2 pl-5 text-left text-lg font-semibold select-none"
            onClick={openNewChat}
            aria-label="Open Codex home"
          >
            Codex
          </button>
          <div className="space-y-px px-2">
            <Button variant="ghost" className="w-full justify-start" onClick={openNewChat}>
              <Plus data-icon="inline-start" />
              New chat
            </Button>
            <Button variant="ghost" className="w-full justify-start" onClick={onOpenSettings}>
              <Settings data-icon="inline-start" />
              Settings
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {model.status === 'unavailable' ? null : (
            <>
              <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
                <div className="group/projects flex items-center px-2 py-2">
                  <CollapsibleTrigger className="flex w-full items-center gap-1 text-sm font-medium text-muted-foreground select-none">
                    <span>Projects</span>
                    <ChevronRight
                      className={cn('size-4 transition-transform', projectsOpen && 'rotate-90')}
                    />
                  </CollapsibleTrigger>
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={cn(
                            'ml-auto',
                            canHover && 'opacity-0 group-hover/projects:opacity-100',
                          )}
                          aria-label={'New project'}
                          onClick={() => {
                            setCreateOpen(true)
                          }}
                        />
                      }
                    >
                      <Plus />
                    </PopoverTrigger>
                    <PopoverContent side="bottom" className="w-auto p-2 text-xs">
                      New project
                    </PopoverContent>
                  </Popover>
                </div>
                <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
                  {model.status === 'loading' ? (
                    <div />
                  ) : model.status === 'error' ? (
                    <LoadError message={model.message} onRetry={onRetryProjects} />
                  ) : model.projects.length === 0 ? (
                    <p className="ml-4 px-2 py-3 text-sm text-muted-foreground">No projects</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <FadePresenceList
                        items={model.projects}
                        getKey={(project) => project.presentationKey ?? project.id}
                      >
                        {(project, exiting) => (
                          <ProjectItem
                            project={project}
                            activeThreadId={activeThreadId}
                            exiting={exiting}
                            onSelectThread={onSelectThread}
                            onRetry={() => onRetryThreads(project.id)}
                            onArchiveThread={onArchiveThread}
                            onDeleteThread={onDeleteThread ?? onArchiveThread}
                            onOpenProjectChat={onOpenProjectChat}
                            onRenameProject={onRenameProject}
                            onDeleteProject={onDeleteProject}
                            drawerMode={isDrawerMode}
                          />
                        )}
                      </FadePresenceList>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
              <ProjectNameDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                mode="create"
                onSubmit={onCreateProject}
              />
              <Collapsible open={threadsOpen} onOpenChange={setThreadsOpen}>
                <CollapsibleTrigger className="flex w-full items-center gap-1 p-2 text-sm font-medium text-muted-foreground select-none">
                  <p>Threads</p>
                  <ChevronRight
                    className={cn('size-4 transition-transform', threadsOpen && 'rotate-90')}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
                  {model.status === 'loading' ? (
                    <div />
                  ) : model.status === 'error' ? null : model.rootThreads.status === 'loading' ? (
                    <div />
                  ) : model.rootThreads.status === 'error' ? (
                    <LoadError
                      message={model.rootThreads.message}
                      onRetry={onRetryRootThreads}
                      compact
                    />
                  ) : model.rootThreads.items.length === 0 ? (
                    <p className="ml-4 px-2 py-2 text-sm text-muted-foreground">No chats</p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <FadePresenceList
                        items={model.rootThreads.items}
                        getKey={(thread) => thread.id}
                      >
                        {(thread, exiting) => (
                          <ThreadItem
                            thread={thread}
                            active={thread.id === activeThreadId}
                            exiting={exiting}
                            onClick={() => onSelectRootThread(thread.id)}
                            onArchive={() => onArchiveThread(null, thread.id)}
                            onDelete={() => (onDeleteThread ?? onArchiveThread)(null, thread.id)}
                            archiveAvailable={archiveAvailable}
                            drawerMode={isDrawerMode}
                          />
                        )}
                      </FadePresenceList>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
        </div>
        <div className="mb-2 shrink-0 px-2">
          {runtimeInteractive && (runtimeStatus === 'stopped' || runtimeStatus === 'error') ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2 p-2"
              onClick={() => void onStartCodex()}
              aria-label={`Codex status: ${displayRuntimeLabel}`}
              aria-live="polite"
            >
              {runtimeContent}
            </Button>
          ) : (
            <div
              className="flex h-8 w-full items-center justify-start gap-2 px-2 text-sm font-medium select-none"
              aria-label={`Codex status: ${displayRuntimeLabel}`}
              aria-live="polite"
            >
              {runtimeContent}
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start gap-2 p-2"
            onClick={() => void onSignOut?.()}
          >
            <LogOut data-icon="inline-start" />
            Sign out
          </Button>
        </div>
      </aside>
    </>
  )
}
