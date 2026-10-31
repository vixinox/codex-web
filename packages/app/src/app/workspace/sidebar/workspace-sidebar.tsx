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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  SidebarSectionHeading,
  SidebarSectionItems,
} from '@/components/shared/sidebar'
import { ProjectNameDialog } from '../project-name-dialog'
import { LoadError, ProjectItem, ThreadItem } from './sidebar-items'
import { useStoredBoolean } from './sidebar-storage'
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
      <Sidebar ref={sidebarRef} width={sidebarWidth} onWidthChange={onSidebarWidthChange}>
        <SidebarHeader>
          <button
            type="button"
            className="py-1 pb-2 pl-5 text-left text-lg font-semibold select-none"
            onClick={openNewChat}
            aria-label="Open Codex home"
          >
            Codex
          </button>
          <div className="space-y-px px-2">
            <SidebarItem icon={<Plus data-icon="inline-start" />} onClick={openNewChat}>
              New chat
            </SidebarItem>
            <SidebarItem icon={<Settings data-icon="inline-start" />} onClick={onOpenSettings}>
              Settings
            </SidebarItem>
          </div>
        </SidebarHeader>
        <SidebarContent>
          {model.status === 'unavailable' ? null : (
            <>
              <SidebarSection>
                <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
                  <div className="group/projects flex items-center px-2 py-2">
                    <SidebarSectionHeading
                      className="w-full px-0 py-0"
                      render={
                        <CollapsibleTrigger className="flex w-full items-center gap-1 text-sm" />
                      }
                    >
                      <span>Projects</span>
                      <ChevronRight
                        className={cn('size-4 transition-transform', projectsOpen && 'rotate-90')}
                      />
                    </SidebarSectionHeading>
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
                      <SidebarSectionItems className="gap-1">
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
                      </SidebarSectionItems>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </SidebarSection>
              <ProjectNameDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                mode="create"
                onSubmit={onCreateProject}
              />
              <SidebarSection>
                <Collapsible open={threadsOpen} onOpenChange={setThreadsOpen}>
                  <SidebarSectionHeading
                    render={<CollapsibleTrigger className="flex w-full items-center gap-1 p-2" />}
                  >
                    <span>Threads</span>
                    <ChevronRight
                      className={cn('size-4 transition-transform', threadsOpen && 'rotate-90')}
                    />
                  </SidebarSectionHeading>
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
                      <SidebarSectionItems>
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
                      </SidebarSectionItems>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </SidebarSection>
            </>
          )}
        </SidebarContent>
        <SidebarFooter>
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
        </SidebarFooter>
      </Sidebar>
    </>
  )
}
