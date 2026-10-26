import type { ThreadClient } from '../interfaces/thread'
import { getOwnerBridge } from '../owner-runtime'
import {
  answerUserInput,
  cancelTurn,
  compactThread,
  createThread,
  fetchThread,
  fetchThreadRuntimeStatus,
  fetchThreads,
  startTurn,
} from '../http/threads'

export const ownerThreadClient: ThreadClient = {
  listThreads: (projectId) => fetchThreads(projectId),
  createThread,
  readThread: fetchThread,
  readThreadStatus: fetchThreadRuntimeStatus,
  startTurn,
  cancelTurn,
  compactThread,
  answerUserInput,
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
