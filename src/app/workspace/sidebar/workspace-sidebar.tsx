import * as React from 'react'
import { ChevronRight, Dot, LogOut, Plus, Settings, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WorkspaceSidebarModel } from '@/app/workspace/model/types'
import type { WorkspaceRuntimeModel } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { useGsapFadeEnter } from '@/lib/platform/browser/use-gsap-enter'
import { ProjectNameDialog } from '../project/project-name-dialog'
import { LoadError, ProjectItem, ThreadItem } from './sidebar-items'
import { useStoredBoolean } from './sidebar-storage'
import { Spinner } from '@/components/ui/spinner'
import { FadePresenceList } from './fade-presence-list'

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
  projectAccess = 'available',
  projectUnavailableMessage = 'Projects are unavailable in Guest Workspace.',
  onProjectUnavailable,
  archiveAvailable = true,
  runtimeStatusLabel,
  runtimeInteractive = true,
  isGuest = false,
  persistUiState = true,
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
  /** Guest-like modes retain the project UI but do not expose project operations. */
  projectAccess?: 'available' | 'unavailable'
  projectUnavailableMessage?: string
  onProjectUnavailable?: () => void
  archiveAvailable?: boolean
  runtimeStatusLabel?: string
  runtimeInteractive?: boolean
  isGuest?: boolean
  /** Fixture workspaces keep collapse state in memory rather than local storage. */
  persistUiState?: boolean
}) {
  const sidebarRef = useGsapFadeEnter<HTMLElement>([settingsActive], {
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
    <TooltipProvider>
      <aside
        ref={sidebarRef}
        className="flex h-full w-78 shrink-0 flex-col bg-sidebar text-sidebar-foreground"
      >
        <div className="flex flex-col pt-3 pb-2">
          <button
            type="button"
            className="px-5 py-1 pb-2 text-left text-lg font-semibold select-none"
            onClick={onOpenNewChat}
            aria-label="Open Codex home"
          >
            Codex
          </button>
          <div className="space-y-px px-2">
            <Button variant="ghost" className="w-full justify-start" onClick={onOpenNewChat}>
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
                  <CollapsibleTrigger
                    render={
                      <div className="flex w-full items-center gap-1 text-sm font-medium text-muted-foreground select-none" />
                    }
                  >
                    <span>Projects</span>
                    <ChevronRight
                      className={cn('size-4 transition-transform', projectsOpen && 'rotate-90')}
                    />
                  </CollapsibleTrigger>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="ml-auto opacity-0 group-hover/projects:opacity-100"
                          aria-label={
                            projectAccess === 'unavailable'
                              ? projectUnavailableMessage
                              : 'New project'
                          }
                          onClick={() => {
                            if (projectAccess === 'unavailable') {
                              onProjectUnavailable?.()
                              return
                            }
                            setCreateOpen(true)
                          }}
                        />
                      }
                    >
                      <Plus />
                    </TooltipTrigger>
                    <TooltipContent>
                      {projectAccess === 'unavailable' ? projectUnavailableMessage : 'New project'}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0">
                  {model.status === 'loading' ? (
                    <div />
                  ) : model.status === 'error' ? (
                    <LoadError message={model.message} onRetry={onRetryProjects} />
                  ) : model.projects.length === 0 ? (
                    <p className="ml-4 px-2 py-3 text-sm text-muted-foreground">
                      {projectAccess === 'unavailable' ? projectUnavailableMessage : 'No projects'}
                    </p>
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
                          />
                        )}
                      </FadePresenceList>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
              {projectAccess === 'available' ? (
                <ProjectNameDialog
                  open={createOpen}
                  onOpenChange={setCreateOpen}
                  mode="create"
                  onSubmit={onCreateProject}
                />
              ) : null}
              <Collapsible open={threadsOpen} onOpenChange={setThreadsOpen}>
                <CollapsibleTrigger
                  render={
                    <div className="flex w-full items-center gap-1 p-2 text-sm font-medium text-muted-foreground select-none" />
                  }
                >
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
        <div className="mb-2 px-2">
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
          {!isGuest ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2 p-2"
              onClick={() => void onSignOut?.()}
            >
              <LogOut data-icon="inline-start" />
              Sign out
            </Button>
          ) : null}
        </div>
      </aside>
    </TooltipProvider>
  )
}
