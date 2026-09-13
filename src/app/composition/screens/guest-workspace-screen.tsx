/* eslint-disable max-lines -- Guest composition owns the isolated route state and reset lifecycle. */
import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ComposerInput } from '@/app/chat/composer/composer-input'
import type { ChatThreadPresentation } from '@/app/chat/model/types'
import { ThreadAssets } from '@/app/chat/transcript/thread-assets'
import { SettingsSidebar } from '@/app/composition/navigation/settings-sidebar'
import { SettingsScreen } from '@/app/composition/screens/settings-screen'
import { WorkspaceSidebar } from '@/app/workspace/sidebar/workspace-sidebar'
import type { WorkspaceSidebarModel } from '@/app/workspace/model/types'
import { readGuestSession } from '@/lib/bridge/http/guest'
import { guestThreadClient } from '@/lib/bridge/thread-adapters'
import { guestComposerAdapter } from '@/app/chat/session/guest-composer-adapter'
import { useComposerController } from '@/app/chat/session/use-composer-controller'
import { useThreadDetailController } from '@/app/chat/session/use-thread-detail-controller'
import { usePendingThreadPresentation } from '@/app/chat/session/use-pending-thread-presentation'
import { ThreadHeader } from '@/app/composition/layout/thread-header'
import { ThreadEmptyState } from '@/app/composition/layout/thread-empty-state'
import { ComposerContainer } from '@/app/composition/layout/composer-container'
import { promoteGuestThread, reconcileGuestThreads } from './guest-thread-order'
import { toast } from '@/components/ui/toast'

const PROJECTS_UNAVAILABLE = 'Projects are unavailable to guests.'
const ARCHIVED_UNAVAILABLE = 'Archived chats are unavailable to guests.'
const GUEST_USER_ID = 'guest'

export function GuestWorkspaceScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const [threads, setThreads] = React.useState<ChatThreadPresentation[]>([])
  const [activeTurn, setActiveTurn] = React.useState<{ threadId: string; turnId: string } | null>(
    null,
  )
  const [ready, setReady] = React.useState(false)
  const [leaseId, setLeaseId] = React.useState<string | null>(null)
  const requestedThreadId = guestThreadIdFromPath(location.pathname)
  const settingsActive = location.pathname === '/app/settings'

  const refreshThreads = React.useCallback(async () => {
    const summaries = await guestThreadClient.listThreads(null)
    setThreads((current) => reconcileGuestThreads(current, summaries))
  }, [])
  const reportUnavailable = React.useCallback(
    () => toast.add({ title: 'Guest runtime is unavailable', type: 'error' }),
    [],
  )
  const detail = useThreadDetailController(
    guestThreadClient,
    ready && requestedThreadId && !settingsActive ? null : undefined,
    requestedThreadId,
    reportUnavailable,
  )
  const pending = usePendingThreadPresentation({
    userId: leaseId ?? GUEST_USER_ID,
    target: { projectId: null, threadId: requestedThreadId },
    thread: detail.model.status === 'ready' ? detail.model.thread : undefined,
  })
  // New Chat is a hard presentation boundary. A background Guest turn may
  // continue, but it must never provide transcript/working UI for /app.
  const visiblePending = requestedThreadId ? pending : null
  const activeThread = visiblePending?.thread ?? visiblePending?.optimisticThread ?? null
  const threadLoading = Boolean(
    requestedThreadId && detail.model.status !== 'ready' && !activeThread,
  )

  React.useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const session = await readGuestSession()
        if (!session) throw new Error('Guest session unavailable')
        if (disposed) return
        // The lease id scopes Composer state, so a new lease cannot inherit the
        // previous lease's draft, model, effort, or selected skills.
        setLeaseId(session.guestId)
        await refreshThreads()
        if (!disposed) setReady(true)
      } catch {
        if (!disposed) toast.add({ title: 'Guest runtime is unavailable', type: 'error' })
      }
    })()
    return () => {
      disposed = true
    }
  }, [refreshThreads])

  React.useEffect(() => {
    if (!ready || !requestedThreadId || settingsActive) return
    let disposed = false
    setActiveTurn(null)
    void guestThreadClient
      .readThreadStatus(null, requestedThreadId)
      .then((status) => {
        if (!disposed)
          setActiveTurn(
            status.activeTurnId
              ? { threadId: requestedThreadId, turnId: status.activeTurnId }
              : null,
          )
        return undefined
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [ready, requestedThreadId, settingsActive])

  const activeTurnReachedRuntime = React.useRef(false)
  React.useEffect(() => {
    activeTurnReachedRuntime.current = false
  }, [activeTurn?.threadId, activeTurn?.turnId])
  React.useEffect(() => {
    if (!activeTurn || detail.model.status !== 'ready') return
    if (detail.model.thread.isBusy) activeTurnReachedRuntime.current = true
    else if (activeTurnReachedRuntime.current) setActiveTurn(null)
  }, [activeTurn, detail.model])

  React.useEffect(() => {
    if (location.pathname === '/app/settings/archived-chats')
      void navigate('/app/settings', { replace: true })
    else if (!['/app', '/app/', '/app/settings'].includes(location.pathname) && !requestedThreadId)
      void navigate('/app', { replace: true })
  }, [location.pathname, navigate, requestedThreadId])

  const activeTurnRef = React.useRef(activeTurn)
  activeTurnRef.current = activeTurn
  const composer = useComposerController({
    userId: leaseId ?? GUEST_USER_ID,
    adapter: guestComposerAdapter,
    host: {
      target: { projectId: null, threadId: requestedThreadId },
      activeTurnId: activeTurn?.turnId ?? null,
      cancelActiveTurn: async () => {
        const current = activeTurnRef.current
        if (!current) return
        await guestThreadClient.cancelTurn(current.threadId, current.turnId)
      },
      onTurnAccepted: (turn) => {
        setActiveTurn({ threadId: turn.threadId, turnId: turn.turnId })
        setThreads((current) => promoteGuestThread(current, turn.threadId))
        void refreshThreads()
      },
      onTurnFollowed: () => detail.followTurn(),
      onThreadCreated: (turn) => {
        setActiveTurn({ threadId: turn.threadId, turnId: turn.turnId })
        void navigate(guestThreadPath(turn.threadId))
      },
      onTurnCancelled: () => {
        const cancelled = activeTurnRef.current
        setActiveTurn(null)
        if (cancelled) detail.retry()
      },
      onError: (message) => toast.add({ title: message, type: 'error' }),
    },
    runtimeReady: ready,
    working: visiblePending?.working ?? false,
    tokenUsage: activeThread?.tokenUsage,
    threadSelection: activeThread
      ? { model: activeThread.model, reasoningEffort: activeThread.reasoningEffort }
      : undefined,
    onPendingChange: pending.onPendingChange,
  })

  const unavailable = React.useCallback(
    () =>
      toast.add({
        title: 'Projects are unavailable',
        description: PROJECTS_UNAVAILABLE,
        type: 'info',
      }),
    [],
  )
  const sidebarModel = React.useMemo<WorkspaceSidebarModel>(
    () => ({
      status: 'ready',
      projects: [],
      rootThreads: {
        status: 'ready',
        items: threads.map((thread) => ({
          id: thread.id,
          title: thread.id === activeThread?.id ? activeThread.title : thread.title,
          updatedAt: Math.floor(
            ((thread.id === activeThread?.id ? activeThread.updatedAt : thread.updatedAt) ?? 0) /
              1_000,
          ),
          status:
            thread.id === activeThread?.id
              ? activeThread.isBusy
                ? ('active' as const)
                : ('idle' as const)
              : thread.isBusy
                ? ('active' as const)
                : ('idle' as const),
        })),
      },
    }),
    [activeThread, threads],
  )
  const sidebar = (
    <WorkspaceSidebar
      model={sidebarModel}
      runtimeStatus="started"
      runtimeStatusLabel={ready ? 'Guest ready' : 'Connecting'}
      activeThreadId={requestedThreadId}
      settingsActive={settingsActive}
      newChatActive={!settingsActive && !requestedThreadId}
      onOpenSettings={() =>
        navigate('/app/settings', {
          state: { settingsReturn: `${location.pathname}${location.search}` },
        })
      }
      onStartCodex={async () => true}
      runtimeInteractive={false}
      isGuest
      onOpenNewChat={() => navigate('/app')}
      onSelectThread={(_, id) => navigate(guestThreadPath(id))}
      onSelectRootThread={(id) => navigate(guestThreadPath(id))}
      onRetryProjects={() => undefined}
      onRetryThreads={() => undefined}
      onRetryRootThreads={() => void refreshThreads()}
      onArchiveThread={async () => undefined}
      onOpenProjectChat={unavailable}
      onCreateProject={async () => {
        unavailable()
      }}
      onRenameProject={async () => {
        unavailable()
      }}
      onDeleteProject={async () => {
        unavailable()
      }}
      projectAccess="unavailable"
      projectUnavailableMessage={PROJECTS_UNAVAILABLE}
      archiveAvailable={false}
      persistUiState={false}
    />
  )
  const settingsSidebar = (
    <SettingsSidebar
      archivedActive={false}
      onBack={() => {
        const settingsReturn = (location.state as { settingsReturn?: string } | null)
          ?.settingsReturn
        void navigate(settingsReturn ?? '/app')
      }}
      onGeneral={() => navigate('/app/settings')}
      onArchived={() => undefined}
      archivedDisabled
      archivedDisabledMessage={ARCHIVED_UNAVAILABLE}
      showArchived={false}
    />
  )

  return (
    <div className="relative flex h-svh w-full bg-sidebar">
      {settingsActive ? settingsSidebar : sidebar}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col rounded-tl-3xl border bg-app-surface">
        {settingsActive ? (
          <SettingsScreen isGuest />
        ) : (
          <>
            {activeThread && !threadLoading ? <ThreadHeader title={activeThread.title} /> : null}
            <div className="min-h-0 flex-1 scrollbar-gutter-stable overflow-auto">
              {threadLoading ? null : activeThread ? (
                <section
                  className="relative flex min-h-full flex-col"
                  aria-label="Guest chat conversation"
                >
                  <ThreadAssets thread={activeThread} />
                </section>
              ) : (
                <ThreadEmptyState
                  title="What would you like to explore?"
                  ariaLabel="Start a guest chat"
                />
              )}
            </div>
            {!threadLoading ? (
              <div className="z-10 flex-none pb-4">
                <ComposerContainer>
                  <ComposerInput
                    viewModel={composer.viewModel}
                    actions={composer.actions}
                    placeholder="Explore the isolated guest workspace"
                    capabilities={composer.capabilities}
                  />
                </ComposerContainer>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  )
}

function guestThreadIdFromPath(pathname: string) {
  const match = pathname.match(/^\/app\/threads\/([^/]+)$/)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
function guestThreadPath(threadId: string) {
  return `/app/threads/${encodeURIComponent(threadId)}`
}
