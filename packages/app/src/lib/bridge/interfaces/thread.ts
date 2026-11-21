/**
 * The browser-facing contract for a Thread runtime.
 *
 * The interface deliberately contains UI-safe values only; transport paths,
 * credentials and runtime-specific identifiers stay behind the adapter.
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
  skills?: readonly { name: string; path: string }[]
}

export type StartedThread = {
  threadId: string
  turnId: string
  projectId: string | null
}

export type StartedTurn = { turnId: string }

export type ThreadClient = {
  listThreads: (projectId: string | null) => Promise<readonly ThreadSummary[]>
  createThread: (input: StartThreadInput, signal?: AbortSignal) => Promise<StartedThread>
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
}
