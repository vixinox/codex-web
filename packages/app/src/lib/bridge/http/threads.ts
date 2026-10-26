import type {
  StartThreadInput,
  StartedThread,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadSummary,
} from '../interfaces/thread'
import { getOwnerBridge } from '../owner-runtime'

export type { ThreadSummary }

export async function fetchThreads(
  projectId: string | null,
  signal?: AbortSignal,
  archived = false,
): Promise<readonly ThreadSummary[]> {
  const value = await getOwnerBridge().request('threads.list', { projectId, archived }, { signal })
  return Array.isArray(value) ? value.filter(isThreadSummary) : []
}

export async function fetchThread(
  projectId: string | null,
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadSnapshot> {
  return asSnapshot(
    await getOwnerBridge().request('threads.read', { projectId, threadId }, { signal }),
  )
}

export async function fetchThreadRuntimeStatus(
  projectId: string | null,
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadRuntimeStatus> {
  return (await getOwnerBridge().request(
    'threads.status',
    { projectId, threadId },
    { signal },
  )) as ThreadRuntimeStatus
}

export async function createThread(
  input: StartThreadInput,
  signal?: AbortSignal,
): Promise<StartedThread> {
  return (await getOwnerBridge().request('threads.create', input, {
    signal,
    mutation: true,
  })) as StartedThread
}

export async function startTurn(threadId: string, input: StartThreadInput, signal?: AbortSignal) {
  return (await getOwnerBridge().request(
    'threads.send',
    { threadId, ...input },
    { signal, mutation: true },
  )) as { turnId: string }
}

export async function cancelTurn(threadId: string, turnId: string) {
  await getOwnerBridge().request('threads.cancel', { threadId, turnId }, { mutation: true })
}

export async function compactThread(threadId: string) {
  await getOwnerBridge().request('threads.compact', { threadId }, { mutation: true })
}

export async function answerUserInput(
  threadId: string,
  requestId: number | string,
  answers: Record<string, { answers: string[] }>,
) {
  await getOwnerBridge().request(
    'userInput.respond',
    { threadId, requestId, answers },
    { mutation: true },
  )
}

export async function archiveThread(projectId: string | null, threadId: string) {
  await getOwnerBridge().request('threads.archive', { projectId, threadId }, { mutation: true })
}

export async function unarchiveThread(projectId: string | null, threadId: string) {
  await getOwnerBridge().request('threads.unarchive', { projectId, threadId }, { mutation: true })
}

export async function deleteThread(projectId: string | null, threadId: string) {
  await getOwnerBridge().request('threads.delete', { projectId, threadId }, { mutation: true })
}

export async function deleteAllArchivedThreads() {
  await getOwnerBridge().request('threads.deleteAll', undefined, { mutation: true })
}

function isThreadSummary(value: unknown): value is ThreadSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.updatedAt === 'number'
  )
}

function asSnapshot(value: unknown): ThreadSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid thread response.')
  return value as ThreadSnapshot
}
