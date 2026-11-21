import * as React from 'react'
import { proxy, useSnapshot } from 'valtio'
import { createConversationState, type ConversationState } from '@codex-web/conversation'
import { applyConversationDelivery } from '@/app/chat/domain/conversation-state'
import { projectConversation } from '@/app/chat/projection/conversation-presentation'
import { releaseComposerUser, retainComposerUser } from '@/app/chat/composer/state/composer-store'

import type { ChatThreadPresentation, ChatTurnPresentation } from '@/app/chat/model/types'
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

export function useThreadSessionSnapshot(session: ThreadSession | null): ThreadSessionSnapshot {
  return useSnapshot(session?.state ?? emptyThreadSessionState)
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
  let conversation: ConversationState | null = null
  let disposed = false
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

  function syncConversation(snapshot: ConversationState) {
    const { turns, ...metadata } = projectConversation(snapshot, projectId)
    syncMetadata(state, metadata)
    const nextOrder = turns.map((turn) => turn.id)
    const nextIds = new Set(nextOrder)
    for (const id of Object.keys(state.turnsById)) {
      if (!nextIds.has(id)) delete state.turnsById[id]
    }
    for (const turn of turns) syncTurn(state, turn)
    if (
      nextOrder.length !== state.turnOrder.length ||
      nextOrder.some((id, index) => id !== state.turnOrder[index])
    ) {
      state.turnOrder = nextOrder
    }
    state.hasCompactionTurn = turns.some((turn) =>
      turn.blocks.some((block) => block.type === 'article' && block.kind === 'context-compaction'),
    )
    state.latestUserBlockId =
      turns
        .findLast((turn) => turn.blocks.some((block) => block.type === 'user'))
        ?.blocks.findLast((block) => block.type === 'user')?.id ?? null
    state.status = 'ready'
    delete state.error
  }

  return {
    key,
    state,
    replaceConversation(snapshot) {
      if (disposed) return
      conversation = createConversationState(snapshot)
      syncConversation(conversation)
    },
    applyConversationChange(change) {
      if (disposed || !conversation) return
      const next = applyConversationDelivery(conversation, change)
      if (next === conversation) return
      conversation = next
      syncConversation(next)
    },
    beginLoad() {
      if (disposed || state.status !== 'error') return
      state.status = 'idle'
      delete state.error
    },
    setError(message) {
      if (disposed) return
      state.status = 'error'
      state.error = message
    },
    dispose() {
      disposed = true
      conversation = null
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

function threadKey(projectId: string | null, threadId: string) {
  return `${projectId ?? '<root>'}\0${threadId}`
}
