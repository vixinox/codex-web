import * as React from 'react'
import {
  AlertCircle,
  Archive,
  Ellipsis,
  FolderClosed,
  Loader2,
  Pen,
  SquarePen,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { WorkspaceProject, WorkspaceThread } from '@/app/workspace/model/types'
import { ProjectNameDialog } from '../project/project-name-dialog'
import { removeStoredValue, useStoredBoolean } from './sidebar-storage'
import { useGsapFadePulse } from '@/lib/platform/browser/use-gsap-enter'
import { FadePresenceList } from './fade-presence-list'
import { toast } from '@/components/ui/toast'

export function ProjectItem({
  project,
  activeThreadId,
  onSelectThread,
  onRetry,
  onArchiveThread,
  onOpenProjectChat,
  onRenameProject,
  onDeleteProject,
  exiting = false,
}: {
  project: WorkspaceProject
  activeThreadId: string | null
  onSelectThread: (projectId: string, threadId: string) => void
  onRetry: () => void
  onArchiveThread: (projectId: string | null, threadId: string) => Promise<void>
  onOpenProjectChat: (projectId: string) => void
  onRenameProject: (projectId: string, name: string) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  exiting?: boolean
}) {
  const [open, setOpen] = useStoredBoolean(`workspace-sidebar:project:${project.id}`, false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)
  const [removeError, setRemoveError] = React.useState<string | null>(null)
  const nameRef = React.useRef<HTMLSpanElement>(null)
  const disabled = project.pending || exiting
  useGsapFadePulse(nameRef, [project.name])
  return (
    <Collapsible open={open} onOpenChange={disabled ? undefined : setOpen}>
      <div className="group/project relative flex items-center rounded-lg">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="w-full min-w-0 justify-start rounded-lg bg-transparent pr-16 font-normal"
              disabled={disabled}
            />
          }
        >
          <FolderClosed data-icon="inline-start" />
          <span ref={nameRef} className="truncate">
            {project.name}
          </span>
        </CollapsibleTrigger>
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="bg-transparent opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100"
                  aria-label={`New chat in ${project.name}`}
                  onClick={() => onOpenProjectChat(project.id)}
                  disabled={disabled}
                />
              }
            >
              <SquarePen />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="mr-1 bg-transparent opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100"
                  aria-label={`Manage ${project.name}`}
                  disabled={disabled}
                />
              }
            >
              <Ellipsis />
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-40 p-1">
              <Button
                variant="ghost"
                className="w-full justify-start text-xs"
                onClick={() => {
                  if (disabled) return
                  setMenuOpen(false)
                  setEditOpen(true)
                }}
              >
                <Pen data-icon="inline-start" /> Edit
              </Button>
              <Separator />
              <Button
                variant="ghost"
                className="w-full justify-start text-xs"
                onClick={() => {
                  if (disabled) return
                  setMenuOpen(false)
                  setRemoveError(null)
                  setRemoveOpen(true)
                }}
              >
                <X data-icon="inline-start" /> Remove project
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <ProjectNameDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="rename"
        initialName={project.name}
        onSubmit={(name) => onRenameProject(project.id, name)}
      />
      <AlertDialog
        open={removeOpen}
        onOpenChange={removing || disabled ? undefined : setRemoveOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the project from the app. Files on your computer and existing chats
              won't be deleted. Existing chats move to Threads.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <p role="alert" className="text-sm text-destructive">
              {removeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={async (event) => {
                event.preventDefault()
                setRemoving(true)
                setRemoveError(null)
                try {
                  await onDeleteProject(project.id)
                  removeStoredValue(`workspace-sidebar:project:${project.id}`)
                  setRemoveOpen(false)
                } catch (error) {
                  setRemoveError(
                    error instanceof Error ? error.message : 'Could not remove this project.',
                  )
                } finally {
                  setRemoving(false)
                }
              }}
            >
              {removing ? <Spinner data-icon="inline-start" /> : null}
              {removing ? 'Removing...' : 'Remove project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 data-ending-style:h-0 data-starting-style:h-0 data-open:opacity-100 data-closed:opacity-0">
        <div className="pl-4">
          {project.threads.status === 'loading' ? (
            <div />
          ) : project.threads.status === 'error' ? (
            <LoadError message={project.threads.message} onRetry={onRetry} compact />
          ) : project.threads.items.length === 0 ? (
            <p className="ml-4 px-2 py-2 text-sm text-muted-foreground">No chats</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              <FadePresenceList items={project.threads.items} getKey={(thread) => thread.id}>
                {(thread, threadExiting) => (
                  <ThreadItem
                    thread={thread}
                    active={thread.id === activeThreadId}
                    exiting={threadExiting || disabled}
                    onClick={() => onSelectThread(project.id, thread.id)}
                    onArchive={() => onArchiveThread(project.id, thread.id)}
                  />
                )}
              </FadePresenceList>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ThreadItem({
  thread,
  active,
  onClick,
  onArchive,
  exiting = false,
  archiveAvailable = true,
}: {
  thread: WorkspaceThread
  active: boolean
  onClick: () => void
  onArchive: () => Promise<void>
  exiting?: boolean
  archiveAvailable?: boolean
}) {
  const [archiving, setArchiving] = React.useState(false)
  const showWorkingIndicator = thread.status === 'active' && !archiving
  return (
    <div
      className={cn(
        'app-interactive group/thread flex w-full items-center rounded-lg',
        active && 'app-state-selected',
      )}
    >
      <Button
        variant="ghost"
        className="min-w-0 flex-1 justify-start bg-transparent! font-normal"
        onClick={onClick}
        disabled={exiting}
        aria-current={active ? 'page' : undefined}
        aria-label={thread.title}
      >
        <span className="truncate">{thread.title}</span>
        {thread.status === 'systemError' ? (
          <AlertCircle className="ml-auto text-destructive" aria-label="Thread error" />
        ) : null}
      </Button>
      {archiveAvailable ? (
        <div
          className={cn(
            'flex shrink-0 items-center pr-2',
            showWorkingIndicator ? '' : 'opacity-0 group-hover/thread:opacity-100',
          )}
        >
          {showWorkingIndicator ? (
            <Loader2
              className="size-4 animate-spin group-hover/thread:hidden"
              aria-label="Working"
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn(showWorkingIndicator && 'hidden group-hover/thread:flex')}
                  disabled={archiving || exiting}
                  onClick={(event) => {
                    event.stopPropagation()
                    setArchiving(true)
                    void onArchive()
                      .catch((error: unknown) => {
                        toast.add({
                          title: 'Could not archive chat',
                          description:
                            error instanceof Error
                              ? error.message
                              : 'Could not archive this thread. Try again.',
                          type: 'error',
                        })
                      })
                      .finally(() => setArchiving(false))
                  }}
                  aria-label={archiving ? 'Archiving chat' : 'Archive chat'}
                />
              }
            >
              {archiving ? <Loader2 className="animate-spin" /> : <Archive />}
            </TooltipTrigger>
            <TooltipContent>
              <p>{archiving ? 'Archiving' : 'Archive chat'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )
}

export function LoadError({
  message,
  onRetry,
  compact = false,
}: {
  message: string
  onRetry: () => void
  compact?: boolean
}) {
  return (
    <Alert className={cn(compact && 'my-1')}>
      <AlertDescription>{message}</AlertDescription>
      <Button variant="outline" size="xs" className="mt-2" onClick={onRetry}>
        Retry
      </Button>
    </Alert>
  )
}
