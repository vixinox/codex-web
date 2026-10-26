import type { StreamHandle } from '@/lib/owner-ws/owner-runtime'
import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
import type {
  StartedThread,
  StartedTurn,
  ThreadClient,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadSummary,
} from '@/lib/bridge/interfaces/thread'

type EventEnvelope = { cursor?: unknown; event?: unknown }

/** Owner-backed Thread domain adapter. It owns event cursor and subscription recovery. */
export const ownerThreadDomainAdapter: ThreadClient = {
  async listThreads(projectId) {
    const value = await getOwnerBridge().request('threads.list', { projectId })
    return Array.isArray(value) ? value.filter(isThreadSummary) : []
  },
  async createThread(input, signal) {
    return getOwnerBridge().request<StartedThread>('threads.create', input, {
      signal,
      mutation: true,
    })
  },
  async readThread(projectId, threadId, signal) {
    return getOwnerBridge().request<ThreadSnapshot>(
      'threads.read',
      { projectId, threadId },
      { signal },
    )
  },
  async readThreadStatus(projectId, threadId, signal) {
    return getOwnerBridge().request<ThreadRuntimeStatus>(
      'threads.status',
      { projectId, threadId },
      { signal },
    )
  },
  async startTurn(threadId, input, signal) {
    return getOwnerBridge().request<StartedTurn>(
      'threads.send',
      { threadId, ...input },
      {
        signal,
        mutation: true,
      },
    )
  },
  async cancelTurn(threadId, turnId) {
    await getOwnerBridge().request('threads.cancel', { threadId, turnId }, { mutation: true })
  },
  async compactThread(threadId) {
    await getOwnerBridge().request('threads.compact', { threadId }, { mutation: true })
  },
  async answerUserInput(threadId, requestId, answers) {
    await getOwnerBridge().request(
      'userInput.respond',
      { threadId, requestId, answers },
      { mutation: true },
    )
  },
  subscribe(threadId, afterId, onEvent, onError) {
    let cursor = afterId
    let subscriptionId: string | null = null
    let current: StreamHandle | null = null
    let cancelled = false
    let recovering = false
    const seen = new Set<number>()

    const receive = (value: unknown) => {
      const envelope = isRecord(value) ? (value as EventEnvelope) : {}
      const nextCursor = typeof envelope.cursor === 'number' ? envelope.cursor : undefined
      const message = envelope.event ?? value
      if (nextCursor === undefined || !isRecord(message)) return
      cursor = nextCursor
      if (seen.has(nextCursor)) return
      seen.add(nextCursor)
      if (seen.size > 2048) seen.delete(seen.values().next().value as number)
      const method = message.method
      const params = message.params
      if (typeof method !== 'string' || !isRecord(params)) return
      onEvent({
        id: nextCursor,
        message: {
          method,
          params,
          ...(typeof message.id === 'number' || typeof message.id === 'string'
            ? { id: message.id }
            : {}),
        },
      })
    }

    const open = (
      method: 'events.subscribe' | 'events.resume',
      params: Record<string, unknown>,
    ) => {
      current = getOwnerBridge().openStream(
        { method, params },
        {
          onOpen: (meta) => {
            if (!isRecord(meta)) return
            if (typeof meta.subscriptionId === 'string') subscriptionId = meta.subscriptionId
            if (typeof meta.cursor === 'number') cursor = meta.cursor
          },
          onEvent: receive,
          onError: () => {
            if (cancelled || recovering || !subscriptionId) {
              if (!cancelled) onError?.()
              return
            }
            recovering = true
            current = null
            void getOwnerBridge()
              .request<{ subscriptionId: string }>('events.resume', {
                subscriptionId,
                cursor,
              })
              .then(() => {
                if (cancelled) return
                open('events.resume', { subscriptionId, cursor })
              })
              .catch(() => onError?.())
              .finally(() => {
                recovering = false
              })
          },
          onClose: (reason) => {
            if (cancelled || reason === 'REQUEST_CANCELLED') return
            if (!recovering) onError?.()
          },
        },
      )
    }

    open('events.subscribe', { scope: 'thread', threadId, afterId })
    return () => {
      cancelled = true
      current?.cancel()
      current = null
    }
  },
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isThreadSummary(value: unknown): value is ThreadSummary {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.updatedAt === 'number'
  )
}
