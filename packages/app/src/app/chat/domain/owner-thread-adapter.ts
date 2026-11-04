import type { StreamHandle } from '@/lib/owner-ws/owner-runtime'
import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
import {
  parseDomainEventEnvelope,
  isOwnerEventErrorCode,
  parseOwnerEventCursor,
  parseOwnerEventStreamMessage,
} from '@codex-web/protocol/owner'
import type {
  StartedThread,
  StartedTurn,
  ThreadClient,
  ThreadRuntimeStatus,
  ThreadSnapshot,
  ThreadSummary,
  ThreadEventError,
} from '@/lib/bridge/interfaces/thread'

export class ThreadEventContractError extends Error {
  readonly code: string

  constructor(code: string, message = eventContractMessage()) {
    super(message)
    this.name = 'ThreadEventContractError'
    this.code = code
  }
}

/** Owner-backed Thread domain adapter. It owns event cursor and subscription recovery. */
export const ownerThreadDomainAdapter: ThreadClient = {
  async listThreads(projectId) {
    const value = await getOwnerBridge().request<unknown>(
      'threads.list',
      projectId ? { projectId } : {},
    )
    const threads = isRecord(value) && Array.isArray(value.data) ? value.data : value
    return Array.isArray(threads) ? threads.filter(isThreadSummary) : []
  },
  async createThread(input, signal) {
    return getOwnerBridge().request<StartedThread>('threads.create', input, {
      signal,
      mutation: true,
    })
  },
  async readThread(projectId, threadId, signal) {
    const response = await getOwnerBridge().request<unknown>(
      'threads.read',
      { projectId, threadId },
      { signal },
    )
    return parseThreadSnapshot(response)
  },
  async readThreadStatus(projectId, threadId, signal) {
    return getOwnerBridge().request<ThreadRuntimeStatus>(
      'threads.status',
      { projectId, threadId },
      { signal },
    )
  },
  async startTurn(threadId, input, signal) {
    return getOwnerBridge().request<StartedTurn>(
      'threads.send',
      { threadId, ...input },
      {
        signal,
        mutation: true,
      },
    )
  },
  async cancelTurn(threadId, turnId) {
    await getOwnerBridge().request('threads.cancel', { threadId, turnId }, { mutation: true })
  },
  async compactThread(threadId) {
    await getOwnerBridge().request('threads.compact', { threadId }, { mutation: true })
  },
  async answerUserInput(threadId, requestId, answers) {
    await getOwnerBridge().request(
      'userInput.respond',
      { threadId, requestId, answers },
      { mutation: true },
    )
  },
  subscribe(threadId, initialCursor, onEvent, onError) {
    let cursor = initialCursor
    let subscriptionId: string | null = null
    let current: StreamHandle | null = null
    let cancelled = false
    let recovering = false
    const seen = new Map<string, string>()

    const failContract = (error: ThreadEventError) => {
      if (cancelled) return
      cancelled = true
      current?.cancel()
      current = null
      onError?.(undefined, false, error)
    }

    const receive = (value: unknown) => {
      const parsed = parseOwnerEventStreamMessage(value)
      if (!parsed.ok) {
        failContract({ ...parsed.error, message: eventContractMessage() })
        return
      }
      if ('method' in parsed.message) {
        const nextCursor = parsed.message.params.cursor
        cursor = nextCursor
        onError?.(nextCursor ?? undefined, true)
        return
      }
      const { cursor: nextCursor, event } = parsed.message
      const eventKey = `${nextCursor.epoch}:${event.eventId}`
      const encodedEvent = stableJson(event)
      const previousEvent = seen.get(eventKey)
      if (previousEvent && previousEvent !== encodedEvent) {
        failContract({
          code: 'EVENT_IDENTITY_MISMATCH',
          message: eventContractMessage(),
        })
        return
      }
      if (previousEvent) return
      if (nextCursor.epoch === cursor.epoch && nextCursor.sequence <= cursor.sequence) return
      seen.set(eventKey, encodedEvent)
      if (seen.size > 2048) seen.delete(seen.keys().next().value as string)
      cursor = nextCursor
      onEvent({
        id: event.eventId,
        cursor: nextCursor,
        event,
      })
    }

    const open = (
      method: 'events.subscribe' | 'events.resume',
      params: Record<string, unknown>,
    ) => {
      const handle = getOwnerBridge().openStream(
        { method, params },
        {
          onOpen: (meta) => {
            if (!isRecord(meta)) return
            if (typeof meta.subscriptionId === 'string') subscriptionId = meta.subscriptionId
            if (meta.cursor !== undefined) {
              const nextCursor = parseOwnerEventCursor(meta.cursor)
              if (!nextCursor) {
                failContract({
                  code: 'INVALID_STREAM_EVENT',
                  message: eventContractMessage(),
                })
                return
              }
              cursor = nextCursor
            }
          },
          onEvent: receive,
          onError: (error) => {
            if (isContractError(error)) {
              failContract(error)
              return
            }
            if (cancelled || recovering || !subscriptionId) {
              if (!cancelled) onError?.()
              return
            }
            recovering = true
            current = null
            if (!subscriptionId) {
              recovering = false
              onError?.()
              return
            }
            open('events.resume', { subscriptionId, cursor })
            recovering = false
          },
          onClose: (reason) => {
            if (cancelled || reason === 'REQUEST_CANCELLED') return
            if (!recovering) onError?.()
          },
        },
      )
      current = handle
      if (cancelled) {
        handle.cancel()
        current = null
      }
    }

    open('events.subscribe', { scope: 'thread', threadId, cursor: initialCursor })
    return () => {
      cancelled = true
      current?.cancel()
      current = null
    }
  },
}

export function parseThreadSnapshot(value: unknown): ThreadSnapshot {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== 'string')
    throw new ThreadEventContractError('INVALID_EVENT_ENVELOPE')
  const eventCursor = parseOwnerEventCursor(value.eventCursor)
  if (!eventCursor) throw new ThreadEventContractError('INVALID_STREAM_EVENT')
  const rawHistory = value.historyEvents ?? []
  if (!Array.isArray(rawHistory)) throw new ThreadEventContractError('INVALID_EVENT_ENVELOPE')

  let previousId = 0
  const historyEvents = rawHistory.map((entry) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.id) || (entry.id as number) <= previousId)
      throw new ThreadEventContractError('INVALID_EVENT_ENVELOPE')
    const parsed = parseDomainEventEnvelope(entry.event)
    if (!parsed.ok) throw new ThreadEventContractError(parsed.error.code, parsed.error.message)
    if (parsed.event.eventId !== entry.id || parsed.event.eventId > eventCursor.sequence)
      throw new ThreadEventContractError('EVENT_CURSOR_MISMATCH')
    previousId = entry.id as number
    return { id: previousId, event: parsed.event }
  })

  return {
    thread: value.thread as ThreadSnapshot['thread'],
    eventCursor,
    historyEvents,
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isContractError(error: Error): error is Error & ThreadEventError {
  return (
    error.name === 'OwnerRequestError' &&
    isOwnerEventErrorCode((error as Error & { code?: string }).code)
  )
}

function eventContractMessage() {
  return 'Owner thread events could not be validated. The current transcript is preserved; reconnect and retry this thread.'
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function isThreadSummary(value: unknown): value is ThreadSummary {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.updatedAt === 'number'
  )
}
