import { ApiRequestError } from './credentials'
import { isCodexThreadResponse, isRecord } from './thread-validation'
import type {
  StartedThread,
  StartedTurn,
  StartThreadInput,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadSummary,
} from '../thread-client'

export type {
  StartedThread,
  StartedTurn,
  StartThreadInput,
  ThreadHistoryEvent,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadSummary,
} from '../thread-client'

export type StartTurnInput = StartThreadInput

type ThreadListItem = {
  id: string
  projectId: string | null
  title: string
  status: ThreadSummary['status']
  updatedAt: number
}

function isThreadRuntimeStatus(value: unknown): value is ThreadRuntimeStatus {
  if (!isRecord(value)) return false
  return (
    typeof value.threadId === 'string' &&
    (typeof value.projectId === 'string' || value.projectId === null) &&
    ['idle', 'inProgress', 'completed', 'failed'].includes(String(value.status)) &&
    typeof value.eventCursor === 'number' &&
    Number.isSafeInteger(value.eventCursor) &&
    value.eventCursor >= 0 &&
    (typeof value.activeTurnId === 'string' || value.activeTurnId === null)
  )
}

function isThreadListItem(value: unknown): value is ThreadListItem {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    (typeof value.projectId === 'string' || value.projectId === null) &&
    typeof value.title === 'string' &&
    ['notLoaded', 'idle', 'systemError', 'active'].includes(String(value.status)) &&
    typeof value.updatedAt === 'number'
  )
}

function isStartedThread(value: unknown): value is StartedThread {
  if (!isRecord(value)) return false
  return (
    typeof value.threadId === 'string' &&
    typeof value.turnId === 'string' &&
    (typeof value.projectId === 'string' || value.projectId === null)
  )
}

function isStartedTurn(value: unknown): value is StartedTurn {
  return isRecord(value) && typeof value.turnId === 'string'
}

export async function startThread(
  input: StartThreadInput,
  signal?: AbortSignal,
): Promise<StartedThread> {
  const { skillHandles, ...requestInput } = input
  let response: Response
  try {
    response = await fetch('/api/threads', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestInput,
        ...(skillHandles?.length ? { skillHandles } : {}),
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }

  if (!response.ok) {
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string')
        code = body.error.code
    } catch {
      // Keep the safe status-based message.
    }
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to start a thread.'
        : code === 'CODEX_START_REQUIRED'
          ? 'Start Codex in Settings before sending a message.'
          : response.status === 404
            ? 'The selected project no longer exists. Choose another project.'
            : code === 'INVALID_SKILL_SELECTION'
              ? 'Selected skills changed. Choose them again and retry.'
              : response.status === 400
                ? 'The message settings are invalid. Review them and try again.'
                : 'Codex could not start this thread. Try again.'
    throw new ApiRequestError(message, response.status, code)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError('The server returned an invalid thread response.', response.status)
  }
  if (!isStartedThread(body) || body.projectId !== input.projectId)
    throw new ApiRequestError('The server returned an invalid thread response.', response.status)
  return { threadId: body.threadId, turnId: body.turnId, projectId: body.projectId }
}

export async function startTurn(
  threadId: string,
  input: StartTurnInput,
  signal?: AbortSignal,
): Promise<StartedTurn> {
  const { skillHandles, ...requestInput } = input
  let response: Response
  try {
    response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestInput,
        ...(skillHandles?.length ? { skillHandles } : {}),
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }

  if (!response.ok) {
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string')
        code = body.error.code
    } catch {
      // Keep the safe status-based message.
    }
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to send a message.'
        : code === 'CODEX_START_REQUIRED'
          ? 'Start Codex in Settings before sending a message.'
          : response.status === 404
            ? 'This thread is no longer available.'
            : response.status === 409
              ? 'Wait for the current response to finish before sending another message.'
              : code === 'INVALID_SKILL_SELECTION'
                ? 'Selected skills changed. Choose them again and retry.'
                : response.status === 400
                  ? 'The message settings are invalid. Review them and try again.'
                  : 'Codex could not send this message. Try again.'
    throw new ApiRequestError(message, response.status, code)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError('The server returned an invalid Turn response.', response.status)
  }
  if (!isStartedTurn(body))
    throw new ApiRequestError('The server returned an invalid Turn response.', response.status)
  return { turnId: body.turnId }
}

export async function compactThread(threadId: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/compact`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }
  if (!response.ok) {
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string')
        code = body.error.code
    } catch {
      // Keep the safe fallback message.
    }
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to compact this chat.'
        : response.status === 404
          ? 'This thread is no longer available.'
          : response.status === 409
            ? 'Wait for the current response to finish before compacting.'
            : 'Codex could not compact this chat. Try again.'
    throw new ApiRequestError(message, response.status, code)
  }
}

export async function cancelTurn(threadId: string, turnId: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(
      `/api/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/cancel`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      },
    )
  } catch {
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }
  if (!response.ok) {
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string')
        code = body.error.code
    } catch {
      // Keep the safe fallback message.
    }
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to stop this response.'
        : response.status === 404
          ? 'This response is no longer available.'
          : response.status === 409
            ? 'This response has already finished.'
            : 'Codex could not stop this response. Try again.'
    throw new ApiRequestError(message, response.status, code)
  }
}

export async function answerUserInput(
  threadId: string,
  requestId: number | string,
  answers: Record<string, { answers: string[] }>,
): Promise<void> {
  const response = await fetch(
    `/api/threads/${encodeURIComponent(threadId)}/user-input/${encodeURIComponent(String(requestId))}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ answers }),
    },
  )
  if (!response.ok)
    throw new ApiRequestError('Could not submit your answers. Try again.', response.status)
}

export async function fetchThreads(
  projectId: string | null,
  signal?: AbortSignal,
  archived = false,
): Promise<readonly ThreadSummary[]> {
  const threads: ThreadSummary[] = []
  let cursor: string | null = null

  do {
    const query = new URLSearchParams({ limit: '100' })
    if (projectId) query.set('projectId', projectId)
    if (archived) query.set('archived', 'true')
    if (cursor) query.set('cursor', cursor)
    // Each page's cursor is only known after the previous page resolves.
    // oxlint-disable-next-line no-await-in-loop -- pagination cursors are inherently sequential
    const response = await requestThreadPage(`/api/threads?${query}`, signal)
    for (const thread of response.data) {
      if (thread.projectId !== projectId) continue
      threads.push({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        status: thread.status,
        updatedAt: thread.updatedAt,
      })
    }
    cursor = response.nextCursor
  } while (cursor)

  return threads
}

async function requestThreadPage(
  path: string,
  signal?: AbortSignal,
): Promise<{ data: ThreadListItem[]; nextCursor: string | null }> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }

  if (!response.ok) {
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string')
        code = body.error.code
    } catch {
      // Keep the safe status-based message.
    }
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to view threads.'
        : code === 'CODEX_START_REQUIRED'
          ? 'Start Codex in Settings to load threads.'
          : response.status >= 500
            ? 'Could not load chats right now.'
            : 'Could not load threads. Try again.'
    throw new ApiRequestError(message, response.status, code)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError('The server returned an invalid threads response.', response.status)
  }
  if (!isRecord(body)) {
    throw new ApiRequestError('The server returned an invalid threads response.', response.status)
  }
  const { data, nextCursor } = body
  if (
    !Array.isArray(data) ||
    !(typeof nextCursor === 'string' || nextCursor === null)
  ) {
    throw new ApiRequestError('The server returned an invalid threads response.', response.status)
  }
  return {
    data: data.map((item) => {
      if (!isThreadListItem(item))
        throw new ApiRequestError(
          'The server returned an invalid threads response.',
          response.status,
        )
      return item
    }),
    nextCursor,
  }
}

export async function fetchThread(
  projectId: string | null,
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadSnapshot> {
  const query = new URLSearchParams()
  if (projectId) query.set('projectId', projectId)
  let response: Response
  try {
    const suffix = query.size ? `?${query}` : ''
    response = await fetch(`/api/threads/${encodeURIComponent(threadId)}${suffix}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }
  if (!response.ok) {
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string')
        code = body.error.code
    } catch {
      // Keep the safe fallback message.
    }
    const message =
      response.status === 404
        ? projectId
          ? 'This thread could not be found in the selected project.'
          : 'This thread could not be found.'
        : response.status === 401
          ? 'Your session has expired. Sign in again to view this thread.'
          : 'Could not load this thread. Try again.'
    throw new ApiRequestError(message, response.status, code)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError('The server returned an invalid thread response.', response.status)
  }
  if (!isCodexThreadResponse(body) || body.thread.id !== threadId)
    throw new ApiRequestError('The server returned an invalid thread response.', response.status)
  return {
    thread: body.thread,
    eventCursor: body.eventCursor,
    ...(body.historyEvents === undefined ? {} : { historyEvents: body.historyEvents }),
  }
}
export async function fetchThreadRuntimeStatus(
  projectId: string | null,
  threadId: string,
  signal?: AbortSignal,
): Promise<ThreadRuntimeStatus> {
  const query = new URLSearchParams()
  if (projectId) query.set('projectId', projectId)
  const suffix = query.size ? `?${query}` : ''
  let response: Response
  try {
    response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/status${suffix}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }
  if (!response.ok) {
    let code: string | null = null
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string')
        code = body.error.code
    } catch {
      // Keep the safe status-based message.
    }
    const message =
      response.status === 401
        ? 'Your session has expired. Sign in again to view this thread.'
        : response.status === 404
          ? 'This thread is no longer available.'
          : 'Thread status is unavailable. Try again.'
    throw new ApiRequestError(message, response.status, code)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiRequestError(
      'The server returned an invalid thread status response.',
      response.status,
    )
  }
  if (!isThreadRuntimeStatus(body) || body.threadId !== threadId || body.projectId !== projectId)
    throw new ApiRequestError(
      'The server returned an invalid thread status response.',
      response.status,
    )
  return body
}
export {
  archiveThread,
  unarchiveThread,
  deleteThread,
  deleteAllArchivedThreads,
} from './thread-lifecycle'
