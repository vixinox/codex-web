import type { CodexThread } from '@/lib/protocol/protocol'

export type ThreadSummary = {
  id: string
  projectId: string | null
  title: string
  status: 'notLoaded' | 'idle' | 'systemError' | 'active'
  updatedAt: number
}

export type StartThreadInput = {
  projectId: string | null
  text: string
  model: string
  reasoningEffort: string
  collaborationMode?: 'default' | 'plan'
  skillHandles?: readonly string[]
}

export type StartedThread = {
  threadId: string
  turnId: string
  projectId: string | null
}

export type StartedTurn = { turnId: string }

export type ThreadHistoryEvent = {
  id: number
  message: { method: string; params?: Record<string, unknown>; id?: number | string }
}

export type ThreadSnapshot = {
  thread: CodexThread
  eventCursor: number
  historyEvents?: ThreadHistoryEvent[]
}

export type ThreadRuntimeStatus = {
  threadId: string
  projectId: string | null
  status: 'idle' | 'inProgress' | 'completed' | 'failed'
  eventCursor: number
  activeTurnId: string | null
}

export type ThreadAvailabilityFetcher<T> = (signal?: AbortSignal) => Promise<T>

export type ThreadEvent = { id: number; message: Record<string, unknown> }

export const THREAD_EVENT_METHODS = [
  'thread/started',
  'thread/status/changed',
  'thread/settings/updated',
  'thread/tokenUsage/updated',
  'thread/archived',
  'thread/deleted',
  'thread/closed',
  'turn/started',
  'turn/completed',
  'turn/failed',
  'error',
  'warning',
  'turn/plan/updated',
  'turn/diff/updated',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/commandExecution/outputDelta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'item/tool/requestUserInput',
  'webcodex/userInput/answered',
  'serverRequest/resolved',
  'webcodex/protocol-error',
] as const

export type ThreadClient = {
  listThreads: (projectId: string | null) => Promise<readonly ThreadSummary[]>
  createThread: (input: StartThreadInput, signal?: AbortSignal) => Promise<StartedThread>
  readThread: (
    projectId: string | null,
    threadId: string,
    signal?: AbortSignal,
  ) => Promise<ThreadSnapshot>
  readThreadStatus: (
    projectId: string | null,
    threadId: string,
    signal?: AbortSignal,
  ) => Promise<ThreadRuntimeStatus>
  startTurn: (
    threadId: string,
    input: StartThreadInput,
    signal?: AbortSignal,
  ) => Promise<StartedTurn>
  cancelTurn: (threadId: string, turnId: string) => Promise<void>
  compactThread: (threadId: string) => Promise<void>
  answerUserInput: (
    threadId: string,
    requestId: number | string,
    answers: Record<string, { answers: string[] }>,
  ) => Promise<void>
  subscribe: (
    threadId: string,
    afterId: number,
    onEvent: (event: ThreadEvent) => void,
    onError?: () => void,
  ) => () => void
}

const MAX_AVAILABILITY_ATTEMPTS = 5

export async function waitForThreadAvailability<T>(
  fetcher: ThreadAvailabilityFetcher<T>,
  signal?: AbortSignal,
) {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_AVAILABILITY_ATTEMPTS; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- each retry must observe the previous attempt's outcome
      return await fetcher(signal)
    } catch (error) {
      if (
        signal?.aborted ||
        !isThreadAvailabilityRace(error) ||
        attempt === MAX_AVAILABILITY_ATTEMPTS - 1
      )
        throw error
      lastError = error
      // oxlint-disable-next-line no-await-in-loop -- backoff delays must elapse in retry order
      await waitForRetry(signal, 2 ** attempt * 100)
    }
  }
  throw lastError
}

export function isThreadAvailabilityRace(error: unknown) {
  if (error === null || typeof error !== 'object' || !('status' in error)) return false
  const { status } = error
  return status === 404 || status === 502 || status === 503
}

function waitForRetry(signal: AbortSignal | undefined, delay: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
