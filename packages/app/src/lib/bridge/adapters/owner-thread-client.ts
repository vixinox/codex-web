import type { ThreadClient } from '../interfaces/thread'
import { getOwnerBridge } from '../owner-runtime'
import * as threadBridge from '../http/threads'

export const ownerThreadClient: ThreadClient = {
  listThreads: (projectId) => threadBridge.fetchThreads(projectId),
  createThread: (...args) => threadBridge.createThread(...args),
  readThread: (...args) => threadBridge.fetchThread(...args),
  readThreadStatus: (...args) => threadBridge.fetchThreadRuntimeStatus(...args),
  startTurn: (...args) => threadBridge.startTurn(...args),
  cancelTurn: (...args) => threadBridge.cancelTurn(...args),
  compactThread: (...args) => threadBridge.compactThread(...args),
  answerUserInput: (...args) => threadBridge.answerUserInput(...args),
  subscribe(threadId, afterId, onEvent, onError) {
    const handle = getOwnerBridge().openStream(
      { method: 'events.subscribe', params: { scope: 'thread', threadId, afterId } },
      {
        onEvent: (value) => {
          if (!value || typeof value !== 'object') return
          const item = value as { cursor?: unknown; event?: unknown }
          const id = typeof item.cursor === 'number' ? item.cursor : 0
          const message = item.event && typeof item.event === 'object' ? item.event : value
          onEvent({ id, message: message as Record<string, unknown> })
        },
        onError,
        onClose: onError,
      },
    )
    return () => handle.cancel()
  },
}
