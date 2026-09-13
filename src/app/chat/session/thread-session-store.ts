import * as React from 'react'
import { proxy, useSnapshot } from 'valtio'
import { releaseComposerUser, retainComposerUser } from '@/app/chat/composer/composer-store'

import {
  applyCodexNotification,
  applyHistoryEvents,
  createCodexThreadState,
  interruptUserInput,
  mergeCodexThreads,
  type CodexHistoryEvent,
  type CodexThreadChange,
  type CodexThreadState,
} from '@/app/chat/native/codex-thread'
import {
  toChatThreadPresentation,
  toChatTurnPresentation,
} from '@/app/chat/projection/thread-presentation'
import type { ChatThreadPresentation, ChatTurnPresentation } from '@/app/chat/model/types'
import type { CodexThread } from '@/lib/protocol/protocol'
import { transcriptDebug } from '@/app/chat/transcript/transcript-debug'

export type ThreadSessionPresentation = Omit<ChatThreadPresentation, 'turns'> & {
  status: 'idle' | 'ready' | 'error'
  error?: string
  turnOrder: string[]
  turnsById: Record<string, ChatTurnPresentation>
  hasCompactionTurn: boolean
  latestUserBlockId: string | null
  inputErrors: string[]
}

export type ThreadSession = {
  readonly key: string
  readonly state: ThreadSessionPresentation
  hydrate: (
    thread: CodexThread,
    eventCursor: number,
    historyEvents?: readonly CodexHistoryEvent[],
  ) => { replayAfterId: number; sparseTurnIds: Set<string> }
  interruptUserInput: () => void
  applyEvent: (
    notification: import('@/app/chat/native/codex-thread').CodexNotification,
    eventId?: string | number,
  ) => void
  hasActiveFollowedTurn: (turnId: string | null) => boolean
  setError: (message: string) => void
  dispose: () => void
}

export class ThreadSessionRegistry {
  private readonly sessions = new Map<string, ThreadSession>()
  private readonly references = new Map<string, number>()
  private readonly lastAccess = new Map<string, number>()
  private readonly maxSessions = 20

  get(projectId: string | null, threadId: string): ThreadSession {
    const key = threadKey(projectId, threadId)
    const existing = this.sessions.get(key)
    if (existing) {
      this.lastAccess.set(key, Date.now())
      return existing
    }
    const session = createThreadSession(key, projectId)
    this.sessions.set(key, session)
    this.references.set(key, 0)
    this.lastAccess.set(key, Date.now())
    return session
  }

  retain(projectId: string | null, threadId: string) {
    const session = this.get(projectId, threadId)
    const key = session.key
    this.references.set(key, (this.references.get(key) ?? 0) + 1)
    this.lastAccess.set(key, Date.now())
    return session
  }

  release(projectId: string | null, threadId: string) {
    const key = threadKey(projectId, threadId)
    if (!this.sessions.has(key)) return
    this.references.set(key, Math.max(0, (this.references.get(key) ?? 0) - 1))
    this.lastAccess.set(key, Date.now())
    this.evict()
  }

  private evict() {
    while (this.sessions.size > this.maxSessions) {
      const candidate = [...this.sessions.entries()]
        .filter(([key, session]) => (this.references.get(key) ?? 0) === 0 && !session.state.isBusy)
        .sort(
          (left, right) =>
            (this.lastAccess.get(left[0]) ?? 0) - (this.lastAccess.get(right[0]) ?? 0),
        )[0]
      if (!candidate) return
      const [key, session] = candidate
      session.dispose()
      this.sessions.delete(key)
      this.references.delete(key)
      this.lastAccess.delete(key)
    }
  }

  dispose() {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    this.references.clear()
    this.lastAccess.clear()
  }
}

const ThreadSessionRegistryContext = React.createContext<ThreadSessionRegistry | null>(null)

export function ThreadSessionRegistryProvider({
  userId,
  children,
}: {
  userId: string
  children: React.ReactNode
}) {
  const registry = React.useMemo(() => new ThreadSessionRegistry(), [])
  React.useEffect(() => {
    retainComposerUser(userId)
    return () => releaseComposerUser(userId)
  }, [userId])
  React.useEffect(() => () => registry.dispose(), [registry])
  return React.createElement(ThreadSessionRegistryContext.Provider, { value: registry }, children)
}

export function useThreadSessionRegistry() {
  const registry = React.useContext(ThreadSessionRegistryContext)
  const fallback = React.useMemo(() => new ThreadSessionRegistry(), [])
  React.useEffect(() => () => fallback.dispose(), [fallback])
  return registry ?? fallback
}

const emptyThreadSessionState = proxy<ThreadSessionPresentation>({
  status: 'idle',
  id: 'invalid-thread',
  projectId: null,
  title: 'Untitled thread',
  updatedAt: null,
  isBusy: false,
  turnOrder: [],
  turnsById: {},
  hasCompactionTurn: false,
  latestUserBlockId: null,
  inputErrors: [],
})

export function useThreadSessionSnapshot(session: ThreadSession | null) {
  return useSnapshot(session?.state ?? emptyThreadSessionState)
}

export function toThreadPresentationSnapshot(
  snapshot: ReturnType<typeof useThreadSessionSnapshot>,
): ChatThreadPresentation {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    title: snapshot.title,
    ...(snapshot.modelProvider ? { modelProvider: snapshot.modelProvider } : {}),
    updatedAt: snapshot.updatedAt,
    isBusy: snapshot.isBusy,
    ...(snapshot.tokenUsage ? { tokenUsage: snapshot.tokenUsage } : {}),
    ...(snapshot.userInput
      ? { userInput: snapshot.userInput as unknown as ChatThreadPresentation['userInput'] }
      : {}),
    turns: snapshot.turnOrder.flatMap((id) => {
      const turn = snapshot.turnsById[id]
      return turn ? [turn as unknown as ChatThreadPresentation['turns'][number]] : []
    }),
  }
}

function createThreadSession(key: string, projectId: string | null): ThreadSession {
  let native: CodexThreadState | null = null
  let disposed = false
  const turnIndexById = new Map<string, number>()
  const turnVersionById = new Map<string, number>()
  const presentationCache = new Map<
    string,
    { version: number; presentation: ChatTurnPresentation }
  >()
  const latestUserBlockByTurn = new Map<string, string | null>()
  const compactionTurns = new Set<string>()
  const inProgressTurns = new Set<string>()
  let latestUserTurnId: string | null = null
  const state = proxy<ThreadSessionPresentation>({
    status: 'idle',
    id: 'invalid-thread',
    projectId,
    title: 'Untitled thread',
    updatedAt: null,
    isBusy: false,
    turnOrder: [],
    turnsById: {},
    hasCompactionTurn: false,
    latestUserBlockId: null,
    inputErrors: [],
  })

  const updateTurnDerived = (turnId: string, turn: ChatTurnPresentation) => {
    const userBlock = [...turn.blocks].reverse().find((block) => block.type === 'user')
    latestUserBlockByTurn.set(turnId, userBlock?.id ?? null)
    if (
      turn.blocks.some((block) => block.type === 'article' && block.kind === 'context-compaction')
    )
      compactionTurns.add(turnId)
    else compactionTurns.delete(turnId)
    if (turn.status === 'inProgress') inProgressTurns.add(turnId)
    else inProgressTurns.delete(turnId)
  }

  const syncInputErrors = () => {
    if (!native) return
    const next = native.protocolErrors
    const unchanged =
      state.inputErrors.length === next.length &&
      state.inputErrors.every((value, index) => value === next[index])
    if (!unchanged) state.inputErrors = [...next]
  }

  const syncTranscriptState = (turnOrder: readonly string[]) => {
    let latestUserBlockId: string | null = null
    for (let index = turnOrder.length - 1; index >= 0; index -= 1) {
      const userBlockId = latestUserBlockByTurn.get(turnOrder[index])
      if (userBlockId) {
        latestUserBlockId = userBlockId
        latestUserTurnId = turnOrder[index]
        break
      }
    }
    state.latestUserBlockId = latestUserBlockId
    state.hasCompactionTurn = compactionTurns.size > 0
  }

  const updateTranscriptDerived = (turnId: string) => {
    const userBlockId = latestUserBlockByTurn.get(turnId)
    const currentIndex = turnIndexById.get(turnId) ?? -1
    const latestIndex = latestUserTurnId ? (turnIndexById.get(latestUserTurnId) ?? -1) : -1
    if (userBlockId && currentIndex >= latestIndex) {
      latestUserTurnId = turnId
      state.latestUserBlockId = userBlockId
    } else if (!userBlockId && latestUserTurnId === turnId) {
      latestUserTurnId = null
      state.latestUserBlockId = null
      syncTranscriptState(state.turnOrder)
    }
    state.hasCompactionTurn = compactionTurns.size > 0
  }

  const syncAll = () => {
    if (!native) return
    const presentation = toChatThreadPresentation(native)
    syncMetadata(state, presentation)
    const nextTurnIds = presentation.turns.map((turn) => turn.id)
    const orderChanged =
      state.turnOrder.length !== nextTurnIds.length ||
      state.turnOrder.some((id, index) => id !== nextTurnIds[index])
    if (orderChanged) state.turnOrder = nextTurnIds
    turnIndexById.clear()
    for (const [index, id] of nextTurnIds.entries()) turnIndexById.set(id, index)
    const nextIds = new Set(nextTurnIds)
    for (const id of Object.keys(state.turnsById)) {
      if (!nextIds.has(id)) {
        delete state.turnsById[id]
        latestUserBlockByTurn.delete(id)
        compactionTurns.delete(id)
        inProgressTurns.delete(id)
        presentationCache.delete(id)
        turnVersionById.delete(id)
      }
    }
    for (const turn of presentation.turns) {
      const version = turnVersionById.get(turn.id) ?? 0
      presentationCache.set(turn.id, { version, presentation: turn })
      syncTurn(state, turn)
      updateTurnDerived(turn.id, turn)
    }
    syncTranscriptState(turnOrderFromIndex())
    syncInputErrors()
  }

  const syncChange = (change: CodexThreadChange) => {
    if (!native || change.scope === 'none') return
    if (change.scope === 'thread') {
      syncAll()
      return
    }
    const index = turnIndexById.get(change.turnId)
    const turns = Array.isArray(native.thread.turns) ? native.thread.turns : []
    if (index === undefined) {
      syncAll()
      return
    }
    const previousStatus = state.turnsById[change.turnId]?.status
    const version = (turnVersionById.get(change.turnId) ?? 0) + 1
    turnVersionById.set(change.turnId, version)
    const cached = presentationCache.get(change.turnId)
    const presentation =
      cached && cached.version === version
        ? cached.presentation
        : toChatTurnPresentation(
            turns[index],
            index,
            index === 0 ? native.protocolErrors : [],
            native.questionnaireSummaries?.[change.turnId],
          )
    presentationCache.set(change.turnId, { version, presentation })
    if (!state.turnOrder.includes(presentation.id))
      state.turnOrder = [...state.turnOrder, presentation.id]
    syncTurn(state, presentation)
    updateTurnDerived(presentation.id, presentation)
    updateTranscriptDerived(presentation.id)
    transcriptDebug({
      phase: 'render',
      turnId: presentation.id,
      status: presentation.status,
      blockCount: presentation.blocks.length,
      assistantBlockCount: presentation.blocks.filter((block) => block.type === 'assistant').length,
      assistantTextLength: presentation.blocks
        .filter(
          (
            block,
          ): block is Extract<ChatTurnPresentation['blocks'][number], { type: 'assistant' }> =>
            block.type === 'assistant',
        )
        .reduce((total, block) => total + block.text.length, 0),
    })
    if (previousStatus !== presentation.status) {
      transcriptDebug({
        phase: 'turn',
        turnId: presentation.id,
        status: `${previousStatus ?? 'unknown'}->${presentation.status}`,
        blockCount: presentation.blocks.length,
      })
    }
    state.isBusy = inProgressTurns.size > 0
    syncInputErrors()
  }

  function turnOrderFromIndex() {
    return [...turnIndexById.entries()].sort((left, right) => left[1] - right[1]).map(([id]) => id)
  }

  return {
    key,
    state,
    hydrate(thread, eventCursor, historyEvents = []) {
      if (disposed) return { replayAfterId: eventCursor, sparseTurnIds: new Set() }
      const snapshot = createCodexThreadState(thread, projectId)
      if (native) {
        native = {
          ...snapshot,
          thread: {
            ...mergeCodexThreads(native.thread, snapshot.thread),
            ...(snapshot.thread.tokenUsage === undefined && native.thread.tokenUsage !== undefined
              ? { tokenUsage: native.thread.tokenUsage }
              : {}),
          },
          seenEventIds: native.seenEventIds,
          protocolErrors: native.protocolErrors,
          ...(native.questionnaireSummaries
            ? { questionnaireSummaries: native.questionnaireSummaries }
            : {}),
          ...(native.userInput ? { userInput: native.userInput } : {}),
        }
      } else native = snapshot
      applyHistoryEvents(native, historyEvents)
      syncAll()
      state.status = 'ready'
      delete state.error
      const sparseTurnIds = sparseInProgressTurnIds(native.thread)
      return { replayAfterId: sparseTurnIds.size ? 0 : eventCursor, sparseTurnIds }
    },
    applyEvent(notification, eventId) {
      if (disposed || !native) return
      transcriptDebug({ phase: 'event', eventId, method: notification.method })
      syncChange(
        applyCodexNotification(
          native,
          notification,
          eventId === undefined ? undefined : String(eventId),
        ),
      )
      const turnId =
        typeof notification.params.turnId === 'string' ? notification.params.turnId : undefined
      const turn = turnId ? state.turnsById[turnId] : undefined
      transcriptDebug({
        phase: 'turn',
        turnId,
        status: turn?.status,
        blockCount: turn?.blocks.length,
      })
    },
    interruptUserInput() {
      if (disposed || !native) return
      syncChange(interruptUserInput(native))
    },
    hasActiveFollowedTurn(turnId) {
      if (!turnId) return false
      return state.turnsById[turnId]?.status === 'inProgress'
    },
    setError(message) {
      if (disposed) return
      state.status = 'error'
      state.error = message
    },
    dispose() {
      disposed = true
      native = null
    },
  }
}

function syncMetadata(
  target: ThreadSessionPresentation,
  source: Omit<ChatThreadPresentation, 'turns'>,
) {
  target.id = source.id
  target.projectId = source.projectId
  target.title = source.title
  target.modelProvider = source.modelProvider
  target.model = source.model
  target.reasoningEffort = source.reasoningEffort
  target.updatedAt = source.updatedAt
  target.isBusy = source.isBusy
  if (source.tokenUsage) target.tokenUsage = source.tokenUsage
  else delete target.tokenUsage
  if (source.userInput) target.userInput = source.userInput
  else delete target.userInput
}

function syncTurn(target: ThreadSessionPresentation, source: ChatTurnPresentation) {
  const existing = target.turnsById[source.id]
  if (!existing) {
    target.turnsById[source.id] = source
    return
  }
  for (const key of Object.keys(existing) as Array<keyof ChatTurnPresentation>) {
    if (!(key in source)) delete existing[key]
  }
  Object.assign(existing, source)
}

function sparseInProgressTurnIds(thread: CodexThread) {
  const ids = new Set<string>()
  for (const turn of Array.isArray(thread.turns) ? thread.turns : []) {
    if (
      !turn ||
      typeof turn !== 'object' ||
      Array.isArray(turn) ||
      turn.status !== 'inProgress' ||
      !Array.isArray(turn.items)
    )
      continue
    if (turn.items.length === 0 && typeof turn.id === 'string') ids.add(turn.id)
  }
  return ids
}

function threadKey(projectId: string | null, threadId: string) {
  return `${projectId ?? '<root>'}\0${threadId}`
}
