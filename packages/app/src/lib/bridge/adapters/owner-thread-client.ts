import type { ThreadClient } from '../interfaces/thread'
import * as threadBridge from '../http/threads'
import { subscribeToEvents } from '../events/event-source'

export const ownerThreadClient: ThreadClient = {
  listThreads: (projectId) => threadBridge.fetchThreads(projectId),
  createThread: (...args) =>
    (
      (threadBridge as typeof threadBridge & { startThread?: typeof threadBridge.createThread })
        .startThread ?? threadBridge.createThread
    )(...args),
  readThread: (...args) => threadBridge.fetchThread(...args),
  readThreadStatus: (...args) => threadBridge.fetchThreadRuntimeStatus(...args),
  startTurn: (...args) => threadBridge.startTurn(...args),
  cancelTurn: (...args) => threadBridge.cancelTurn(...args),
  compactThread: (...args) => threadBridge.compactThread(...args),
  answerUserInput: (...args) => threadBridge.answerUserInput(...args),
  subscribe(threadId, afterId, onEvent, onError) {
    return subscribeToEvents({
      url: `/api/events?threadId=${encodeURIComponent(threadId)}&afterId=${afterId}`,
      events: ['*'],
      onEvent: (event) => {
        const messageEvent = event as MessageEvent
        const value =
          (event as Event & { detail?: unknown }).detail ??
          (typeof messageEvent.data === 'string' ? JSON.parse(messageEvent.data) : event)
        if (!value || typeof value !== 'object') return
        const item = value as {
          id?: unknown
          message?: unknown
          method?: unknown
          params?: unknown
        }
        const id =
          typeof item.id === 'number'
            ? item.id
            : Number.parseInt(messageEvent.lastEventId ?? '', 10)
        const message =
          item.message && typeof item.message === 'object'
            ? item.message
            : typeof item.method === 'string'
              ? {
                  method: item.method,
                  ...(typeof item.id === 'number' || typeof item.id === 'string'
                    ? { id: item.id }
                    : {}),
                  params: item.params ?? {},
                }
              : null
        if (Number.isFinite(id) && message)
          onEvent({ id, message: message as Record<string, unknown> })
      },
      onError,
    })
  },
}
