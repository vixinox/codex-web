import type { CodexThread } from '@/lib/protocol/protocol'

/**
 * The browser-facing contract for a Thread runtime.
 *
 * Owner and Guest satisfy this same interface through separate adapters. The
 * interface deliberately contains UI-safe values only; transport paths,
 * credentials and runtime-specific identifiers stay behind the adapters.
 */
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

export type ThreadEvent = { id: number; message: Record<string, unknown> }

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
