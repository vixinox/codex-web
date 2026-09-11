import * as ownerThreads from './http/threads'
import {
  answerGuestUserInput,
  cancelGuestTurn,
  compactGuestThread,
  createGuestThread,
  fetchGuestThread,
  fetchGuestThreadRuntimeStatus,
  fetchGuestThreads,
  openGuestEventStream,
  startGuestTurn,
} from './http/guest'
import { subscribeToEvents } from './events/event-source'
import { THREAD_EVENT_METHODS, type ThreadClient } from './thread-client'

export const ownerThreadClient: ThreadClient = {
  listThreads: (projectId) => ownerThreads.fetchThreads(projectId),
  createThread: (input, signal) => ownerThreads.startThread(input, signal),
  readThread: (projectId, threadId, signal) =>
    ownerThreads.fetchThread(projectId, threadId, signal),
  readThreadStatus: (projectId, threadId, signal) =>
    ownerThreads.fetchThreadRuntimeStatus(projectId, threadId, signal),
  startTurn: (threadId, input, signal) => ownerThreads.startTurn(threadId, input, signal),
  cancelTurn: (threadId, turnId) => ownerThreads.cancelTurn(threadId, turnId),
  compactThread: (threadId) => ownerThreads.compactThread(threadId),
  answerUserInput: ownerThreads.answerUserInput,
  subscribe: (threadId, afterId, onEvent, onError) =>
    subscribeToEvents({
      url: `/api/events?threadId=${encodeURIComponent(threadId)}&afterId=${afterId}`,
      events: THREAD_EVENT_METHODS,
      onEvent: (event) => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data) as Record<
            string,
            unknown
          >
          const id = Number((event as MessageEvent).lastEventId)
          if (Number.isSafeInteger(id) && id >= 0) onEvent({ id, message })
        } catch {
          onError?.()
        }
      },
      onError,
    }),
}

export const guestThreadClient: ThreadClient = {
  listThreads: async () =>
    (await fetchGuestThreads()).map((thread) =>
      Object.assign({}, thread, {
        projectId: null,
        status: thread.status === 'active' ? 'active' : 'idle',
      }),
    ),
  createThread: async (input) => ({ ...(await createGuestThread(input)), projectId: null }),
  readThread: async (_projectId, threadId) => fetchGuestThread(threadId),
  readThreadStatus: async (_projectId, threadId) => fetchGuestThreadRuntimeStatus(threadId),
  startTurn: async (threadId, input) => startGuestTurn(threadId, input),
  cancelTurn: cancelGuestTurn,
  compactThread: compactGuestThread,
  answerUserInput: answerGuestUserInput,
  subscribe: openGuestEventStream,
}
