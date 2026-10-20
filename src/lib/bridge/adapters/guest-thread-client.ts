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
} from '../http/guest'
import type { ThreadClient } from '../interfaces/thread'

/** Guest adapter; its queue/job handle remains opaque to the ThreadClient. */
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
