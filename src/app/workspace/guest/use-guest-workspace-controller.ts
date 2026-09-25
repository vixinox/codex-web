import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { ChatThreadPresentation } from '@/app/chat/model/types'
import { guestComposerAdapter } from '@/app/chat/session/adapters/guest-composer-adapter'
import { buildThreadComposerSlot } from '@/app/chat/session/presentation/thread-composer-slot'
import { useComposerController } from '@/app/chat/session/controllers/use-composer-controller'
import { usePendingThreadPresentation } from '@/app/chat/session/presentation/use-pending-thread-presentation'
import { useThreadDetailController } from '@/app/chat/session/controllers/use-thread-detail-controller'
import type { WorkspaceSidebarModel } from '@/app/workspace/workspace-model'
import { readGuestSession } from '@/lib/bridge/http/guest'
import { fetchRuntimeCapabilities } from '@/lib/bridge/http/configuration'
import {
  composerCapabilitiesFromModels,
  type ComposerCapabilities,
} from '@/app/chat/composer/model/composer-capabilities'
import { guestThreadClient } from '@/lib/bridge/thread-adapters'
import { toast } from '@/components/ui/toast'
import {
  promoteGuestThread,
  reconcileGuestThreads,
} from '@/app/composition/screens/guest-thread-order'

const PROJECTS_UNAVAILABLE = 'Projects are unavailable to guests.'
const ARCHIVED_UNAVAILABLE = 'Archived chats are unavailable to guests.'

export type GuestWorkspaceController = {
  ready: boolean
  requestedThreadId: string | null
  settingsActive: boolean
  activeThread: ChatThreadPresentation | null
  threadLoading: boolean
  detail: ReturnType<typeof useThreadDetailController>
  composer: ReturnType<typeof useComposerController>
  composerSlot: ReturnType<typeof buildThreadComposerSlot> | undefined
  threadComposerActions: ReturnType<typeof useComposerController>['actions'] & {
    retry: () => void
    answerUserInput: ReturnType<typeof useThreadDetailController>['answerUserInput']
    cancelUserInput: ReturnType<typeof useThreadDetailController>['cancelUserInput']
  }
  sidebarModel: WorkspaceSidebarModel
  refreshThreads: () => Promise<void>
  navigate: ReturnType<typeof useNavigate>
  location: ReturnType<typeof useLocation>
  unavailable: () => void
  projectUnavailableMessage: string
  archivedUnavailableMessage: string
}

export function useGuestWorkspaceController(): GuestWorkspaceController {
  const location = useLocation()
  const navigate = useNavigate()
  const [threads, setThreads] = React.useState<ChatThreadPresentation[]>([])
  const [activeTurn, setActiveTurn] = React.useState<{ threadId: string; turnId: string } | null>(
    null,
  )
  const [ready, setReady] = React.useState(false)
  const [leaseId, setLeaseId] = React.useState<string | null>(null)
  const [capabilities, setCapabilities] = React.useState<ComposerCapabilities | undefined>()
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
    userId: leaseId ?? 'guest',
    target: { projectId: null, threadId: requestedThreadId },
    thread: detail.model.status === 'ready' ? detail.model.thread : undefined,
  })
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
        setLeaseId(session.guestId)
        const catalog = await fetchRuntimeCapabilities('/guest-api/capabilities')
        setCapabilities(
          composerCapabilitiesFromModels(catalog.models, 'workspaceWrite', {
            attachments: false,
            contextUsage: true,
          }),
        )
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
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [ready, requestedThreadId, settingsActive])

  React.useEffect(() => {
    if (location.pathname === '/app/settings/archived-chats')
      void navigate('/app/settings', { replace: true })
    else if (!['/app', '/app/', '/app/settings'].includes(location.pathname) && !requestedThreadId)
      void navigate('/app', { replace: true })
  }, [location.pathname, navigate, requestedThreadId])

  const activeTurnRef = React.useRef(activeTurn)
  activeTurnRef.current = activeTurn
  const composer = useComposerController({
    userId: leaseId ?? 'guest',
    adapter: guestComposerAdapter,
    capabilities,
    host: {
      target: { projectId: null, threadId: requestedThreadId },
      activeTurnId: activeTurn?.turnId ?? null,
      cancelActiveTurn: async () => {
        const current = activeTurnRef.current
        if (current) await guestThreadClient.cancelTurn(current.threadId, current.turnId)
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
  const composerSlot = activeThread
    ? buildThreadComposerSlot(composer.viewModel, activeThread.turns, activeThread.userInput)
    : undefined
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
              1000,
          ),
          status: (thread.id === activeThread?.id ? activeThread.isBusy : thread.isBusy)
            ? 'active'
            : 'idle',
        })),
      },
    }),
    [activeThread, threads],
  )
  return {
    ready,
    requestedThreadId,
    settingsActive,
    activeThread,
    threadLoading,
    detail,
    composer,
    composerSlot,
    threadComposerActions: {
      ...composer.actions,
      retry: detail.retry,
      answerUserInput: detail.answerUserInput,
      cancelUserInput: detail.cancelUserInput,
    } as GuestWorkspaceController['threadComposerActions'],
    sidebarModel,
    refreshThreads,
    navigate,
    location,
    unavailable: () =>
      toast.add({
        title: 'Projects are unavailable',
        description: PROJECTS_UNAVAILABLE,
        type: 'info',
      }),
    projectUnavailableMessage: PROJECTS_UNAVAILABLE,
    archivedUnavailableMessage: ARCHIVED_UNAVAILABLE,
  }
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
