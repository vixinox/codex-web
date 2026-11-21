import * as React from 'react'
import { createConversationState, type ConversationState } from '@codex-web/conversation'
import { applyConversationDelivery } from '@/app/chat/domain/conversation-state'
import { createConversationProjector } from '@/app/chat/projection/conversation-presentation'
import { releaseComposerUser, retainComposerUser } from '@/app/chat/composer/state/composer-store'

import type { ChatThreadPresentation } from '@/app/chat/model/types'
import type { ThreadSession, ThreadSessionPresentation, ThreadSessionSnapshot } from '../interface'

export type { ThreadSession, ThreadSessionPresentation } from '../interface'

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

const emptyThreadSessionState: ThreadSessionPresentation = {
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
}

const emptySubscribe = () => () => {}

export function useThreadSessionSnapshot(session: ThreadSession | null): ThreadSessionSnapshot {
  return React.useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? (() => emptyThreadSessionState),
  )
}

export function toThreadPresentationSnapshot(
  snapshot: ThreadSessionSnapshot,
): ChatThreadPresentation {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    title: snapshot.title,
    ...(snapshot.model ? { model: snapshot.model } : {}),
    ...(snapshot.reasoningEffort ? { reasoningEffort: snapshot.reasoningEffort } : {}),
    ...(snapshot.modelProvider ? { modelProvider: snapshot.modelProvider } : {}),
    updatedAt: snapshot.updatedAt,
    isBusy: snapshot.isBusy,
    pendingInputCount: snapshot.pendingInputCount,
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

export function createThreadSession(key: string, projectId: string | null): ThreadSession {
  let conversation: ConversationState | null = null
  let disposed = false
  let state: ThreadSessionPresentation = { ...emptyThreadSessionState, projectId }
  const listeners = new Set<() => void>()
  const projectConversation = createConversationProjector()
  const publish = (next: ThreadSessionPresentation) => {
    state = next
    for (const listener of listeners) listener()
  }
  const update = (next: ConversationState, source: 'initial' | 'live' | 'recovery') => {
    conversation = next
    const { turns, ...metadata } = projectConversation(next, projectId)
    publish({
      ...metadata, status: 'ready', updateSource: source,
      turnOrder: turns.map((turn) => turn.id),
      turnsById: Object.fromEntries(turns.map((turn) => [turn.id, turn])),
      hasCompactionTurn: turns.some((turn) => turn.blocks.some((block) => block.type === 'article')),
      latestUserBlockId: turns.findLast((turn) => turn.blocks.some((block) => block.type === 'user'))?.blocks.findLast((block) => block.type === 'user')?.id ?? null,
      inputErrors: next.diagnostics.map((entry) => entry.summary),
    })
  }
  return {
    key,
    get state() { return state },
    getSnapshot: () => state,
    getConversation: () => conversation,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    replaceConversation(snapshot) {
      if (!disposed) update(createConversationState(snapshot), conversation ? 'recovery' : 'initial')
    },
    applyConversationChange(change) {
      if (disposed || !conversation) return
      const next = applyConversationDelivery(conversation, change)
      if (next !== conversation) update(next, 'live')
    },
    beginLoad() {
      if (!disposed && state.status === 'error') publish({ ...state, status: 'idle', error: undefined })
    },
    setError(message) {
      if (!disposed) publish({ ...state, status: conversation ? 'ready' : 'error', error: message })
    },
    dispose() { disposed = true; conversation = null; listeners.clear() },
  }
}

function threadKey(projectId: string | null, threadId: string) {
  return `${projectId ?? '<root>'}\0${threadId}`
}
