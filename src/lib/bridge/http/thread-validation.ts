import type { CodexRecord, CodexThread } from '@/lib/protocol/protocol'

export type ThreadHistoryEventDto = {
  id: number
  message: { method: string; params?: CodexRecord; id?: number | string }
}

export function isCodexThreadResponse(value: unknown): value is {
  thread: CodexThread
  eventCursor: number
  historyEvents?: ThreadHistoryEventDto[]
} {
  if (!isRecord(value) || !isRecord(value.thread)) return false
  const thread = value.thread
  if (typeof thread.id !== 'string' || !Array.isArray(thread.turns)) return false
  const eventCursor = value.eventCursor
  return (
    typeof eventCursor === 'number' &&
    Number.isSafeInteger(eventCursor) &&
    eventCursor >= 0 &&
    (value.historyEvents === undefined ||
      (Array.isArray(value.historyEvents) && value.historyEvents.every(isThreadHistoryEvent))) &&
    thread.turns.every(isCodexTurn)
  )
}

function isThreadHistoryEvent(value: unknown): value is ThreadHistoryEventDto {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1
  )
    return false
  const message = value.message
  return (
    isRecord(message) &&
    typeof message.method === 'string' &&
    (message.params === undefined || isRecord(message.params)) &&
    (message.id === undefined || typeof message.id === 'string' || typeof message.id === 'number')
  )
}

export function isCodexTurn(value: unknown): value is CodexRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.status === 'string'
}

export function isRecord(value: unknown): value is CodexRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
