import type { CodexThread } from '@/lib/protocol/protocol'
import { THREAD_EVENT_METHODS } from '@/lib/bridge/thread-client'
import { isCodexThreadResponse, isRecord, type ThreadHistoryEventDto } from './thread-validation'
import type { GuestRuntimeContract } from '../guest-contract'
export type { GuestRuntimeContract } from '../guest-contract'

export type GuestSession = {
  guestId: string
  expiresAt: string
  runtime: GuestRuntimeContract
}

export type GuestThreadSummary = {
  id: string
  projectId: null
  title: string
  status: 'idle' | 'active'
  updatedAt: number
}
export type GuestThreadSnapshot = {
  thread: CodexThread
  eventCursor: number
  historyEvents?: ThreadHistoryEventDto[]
}

export class GuestApiRequestError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'GuestApiRequestError'
    this.status = status
    this.code = code
  }
}

export async function startGuestSession(signal?: AbortSignal) {
  const response = await fetch('/guest-api/session', {
    method: 'POST',
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error('Guest access is unavailable')
  return parseGuestSession(await response.json())
}

export async function readGuestSession(signal?: AbortSignal) {
  const response = await fetch('/guest-api/session', { credentials: 'include', signal })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Guest access is unavailable')
  return parseGuestSession(await response.json())
}

function parseGuestSession(value: unknown): GuestSession {
  if (!isRecord(value)) throw new Error('Guest access is unavailable')
  const { guestId, expiresAt, runtime } = value
  if (
    typeof guestId !== 'string' ||
    typeof expiresAt !== 'string' ||
    !isGuestRuntimeContract(runtime)
  )
    throw new Error('Guest access is unavailable')
  return { guestId, expiresAt, runtime }
}

function isGuestRuntimeContract(value: unknown): value is GuestRuntimeContract {
  if (!isRecord(value)) return false
  return (
    value.kind === 'guest-runtime' &&
    ['starting', 'ready', 'failed', 'stopped', 'not-configured'].includes(String(value.status)) &&
    value.sandbox === 'workspaceWrite' &&
    value.network === 'disabled' &&
    typeof value.modelContextWindow === 'number' &&
    Number.isSafeInteger(value.modelContextWindow) &&
    value.modelContextWindow > 0
  )
}

async function guestRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  })
  if (!response.ok) {
    let message = 'Guest access is unavailable'
    let code: string | null = null
    try {
      const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
      if (typeof body.error?.code === 'string') code = body.error.code
      if (typeof body.error?.message === 'string') message = body.error.message
    } catch {
      /* safe fallback */
    }
    throw new GuestApiRequestError(message, response.status, code)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export async function resetGuestSession() {
  return guestRequest<GuestSession>('/guest-api/reset', { method: 'POST' })
}
export async function fetchGuestThreads() {
  return (await guestRequest<{ data: GuestThreadSummary[] }>('/guest-api/threads')).data
}
export async function createGuestThread(input: {
  text: string
  model: string
  reasoningEffort: string
  collaborationMode?: string
  skillHandles?: readonly string[]
}) {
  return guestRequest<{ threadId: string; turnId: string }>('/guest-api/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}
export async function fetchGuestThread(threadId: string) {
  const snapshot = await guestRequest<unknown>(`/guest-api/threads/${encodeURIComponent(threadId)}`)
  if (!isCodexThreadResponse(snapshot) || snapshot.thread.id !== threadId)
    throw new Error('Guest access returned an invalid thread')
  return snapshot
}
export async function fetchGuestThreadRuntimeStatus(threadId: string) {
  return guestRequest<{
    threadId: string
    projectId: null
    status: 'idle' | 'inProgress'
    eventCursor: number
    activeTurnId: string | null
  }>(`/guest-api/threads/${encodeURIComponent(threadId)}/status`)
}
export async function startGuestTurn(
  threadId: string,
  input: {
    text: string
    model: string
    reasoningEffort: string
    collaborationMode?: string
    skillHandles?: readonly string[]
  },
) {
  return guestRequest<{ turnId: string }>(
    `/guest-api/threads/${encodeURIComponent(threadId)}/turns`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}
export async function cancelGuestTurn(threadId: string, turnId: string) {
  await guestRequest<void>(
    `/guest-api/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/cancel`,
    { method: 'POST' },
  )
}
export async function compactGuestThread(threadId: string) {
  await guestRequest<void>(`/guest-api/threads/${encodeURIComponent(threadId)}/compact`, {
    method: 'POST',
  })
}
export async function answerGuestUserInput(
  threadId: string,
  requestId: number | string,
  answers: Record<string, { answers: string[] }>,
) {
  await guestRequest<void>(
    `/guest-api/threads/${encodeURIComponent(threadId)}/user-input/${encodeURIComponent(String(requestId))}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    },
  )
}
export async function fetchGuestCapacity() {
  return guestRequest<Record<string, unknown>>('/guest-api/capacity')
}

export type GuestSkill = {
  handle: string
  name: string
  displayName: string
  description: string
  scope: 'user' | 'repo' | 'system' | 'admin'
}

export async function fetchGuestSkills() {
  return (await guestRequest<{ data: GuestSkill[] }>('/guest-api/skills')).data
}

export function openGuestEventStream(
  threadId: string,
  afterId: number,
  onEvent: (event: { id: number; message: Record<string, unknown> }) => void,
  onError?: () => void,
) {
  const source = new EventSource(
    `/guest-api/events?threadId=${encodeURIComponent(threadId)}&afterId=${afterId}`,
    { withCredentials: true },
  )
  const receive = (event: MessageEvent<string>) => {
    try {
      const message = JSON.parse(event.data) as Record<string, unknown>
      const id = Number(event.lastEventId)
      if (Number.isSafeInteger(id) && id >= 0) onEvent({ id, message })
    } catch {
      /* malformed Guest events are ignored; the next snapshot reconciles state. */
    }
  }
  for (const name of THREAD_EVENT_METHODS) source.addEventListener(name, receive as EventListener)
  source.onerror = () => onError?.()
  return () => source.close()
}
