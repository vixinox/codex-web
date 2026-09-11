import type { CodexRecord, CodexThread } from '@/lib/protocol/protocol'
import type { ChatQuestionnaireSummary } from '@/app/chat/model/types'

const MAX_ACCUMULATED_TEXT = 200_000
const MAX_SEEN_EVENT_IDS = 2_000

export type CodexNotification = { method: string; params: CodexRecord; id?: number | string }
export type CodexHistoryEvent = {
  id: number
  message: CodexNotification
}
export type CodexThreadState = {
  projectId: string | null
  thread: CodexThread
  seenEventIds: Set<string>
  protocolErrors: string[]
  questionnaireSummaries?: Record<string, ChatQuestionnaireSummary>
  userInput?: {
    requestId: number | string
    turnId: string
    itemId: string
    questions: CodexRecord[]
    isBlocking: boolean
  }
}

export type CodexThreadChange =
  | { scope: 'none' }
  | { scope: 'thread' }
  | { scope: 'turn'; turnId: string }

export function createCodexThreadState(
  thread: CodexThread,
  projectId: string | null,
): CodexThreadState {
  return { projectId, thread, seenEventIds: new Set(), protocolErrors: [] }
}

export function mergeCodexThreads(current: CodexThread, snapshot: CodexThread): CodexThread {
  const currentTurns = Array.isArray(current.turns) ? current.turns.filter(isRecord) : []
  const snapshotTurns = Array.isArray(snapshot.turns) ? snapshot.turns.filter(isRecord) : []
  const currentById = new Map(
    currentTurns.flatMap((turn) => (typeof turn.id === 'string' ? [[turn.id, turn] as const] : [])),
  )
  const mergedTurns = snapshotTurns.map((turn) => {
    const id = typeof turn.id === 'string' ? turn.id : undefined
    return id && currentById.has(id) ? mergeTurn(currentById.get(id)!, turn) : turn
  })
  const snapshotIds = new Set(
    snapshotTurns.flatMap((turn) => (typeof turn.id === 'string' ? [turn.id] : [])),
  )
  mergedTurns.push(
    ...currentTurns.filter((turn) => typeof turn.id !== 'string' || !snapshotIds.has(turn.id)),
  )
  return { ...current, ...snapshot, turns: mergedTurns }
}

export function reduceCodexNotification(
  state: CodexThreadState,
  notification: CodexNotification,
  eventId?: string,
): CodexThreadState {
  const next = structuredClone(state)
  applyCodexNotification(next, notification, eventId)
  return next
}

// The session store owns this mutable state. The immutable wrapper above remains the
// public reducer for callers and tests that need snapshot-style state transitions.
export function applyCodexNotification(
  state: CodexThreadState,
  notification: CodexNotification,
  eventId?: string,
): CodexThreadChange {
  if (eventId && state.seenEventIds.has(eventId)) return { scope: 'none' }
  if (eventId) {
    state.seenEventIds.add(eventId)
    if (state.seenEventIds.size > MAX_SEEN_EVENT_IDS)
      state.seenEventIds.delete(state.seenEventIds.values().next().value!)
  }
  const params = notification.params
  if (notification.method === 'webcodex/protocol-error') {
    appendError(state, `Codex protocol error: ${safeCode(params.code)}`)
    return { scope: 'thread' }
  }
  if (notification.method === 'item/tool/requestUserInput') {
    const requestId = notification.id ?? params.requestId
    const threadId = stringValue(params.threadId) ?? stringValue(state.thread.id)
    const turnId = stringValue(params.turnId) ?? inProgressTurn(state.thread)
    const itemId = stringValue(params.itemId) ?? `user-input-${String(requestId)}`
    const questions = Array.isArray(params.questions) ? params.questions.filter(isRecord) : []
    if (!validRequestId(requestId) || !threadId || !turnId || !itemId || !questions.length) {
      appendError(state, 'item/tool/requestUserInput is incomplete')
      return { scope: 'thread' }
    }
    state.userInput = {
      requestId,
      turnId,
      itemId,
      questions,
      isBlocking: typeof params.isBlocking === 'boolean' ? params.isBlocking : true,
    }
    return { scope: 'thread' }
  }
  if (notification.method === 'webcodex/userInput/answered') {
    return finalizeUserInput(state, params.requestId, params.answers)
  }
  if (notification.method === 'serverRequest/resolved') {
    return finalizeUserInput(state, params.requestId)
  }
  const thread = state.thread
  if (notification.method === 'thread/status/changed' && isRecord(params.status)) {
    thread.status = params.status
    return { scope: 'thread' }
  }
  if (notification.method === 'thread/started' && isRecord(params.thread)) {
    Object.assign(thread, params.thread)
    return { scope: 'thread' }
  }
  if (notification.method === 'thread/tokenUsage/updated') {
    if (
      !stringValue(params.threadId) ||
      !stringValue(params.turnId) ||
      !isRecord(params.tokenUsage)
    ) {
      appendError(state, 'thread/tokenUsage/updated is incomplete')
      return { scope: 'thread' }
    }
    thread.tokenUsage = params.tokenUsage
    return { scope: 'thread' }
  }
  if (notification.method === 'thread/settings/updated') {
    if (!stringValue(params.threadId)) {
      appendError(state, 'thread/settings/updated is incomplete')
      return { scope: 'thread' }
    }
    if (typeof params.model === 'string') thread.model = params.model
    if (typeof params.reasoningEffort === 'string') thread.reasoningEffort = params.reasoningEffort
    return { scope: 'thread' }
  }
  if (
    ['turn/started', 'turn/completed', 'turn/failed'].includes(notification.method) &&
    isRecord(params.turn)
  ) {
    upsertTurn(thread, params.turn)
    if (
      (notification.method === 'turn/completed' || notification.method === 'turn/failed') &&
      isTokenUsage(params.tokenUsage)
    )
      thread.tokenUsage = params.tokenUsage
    const turnId = stringValue(params.turn.id)
    return turnId ? { scope: 'turn', turnId } : { scope: 'thread' }
  }
  if (notification.method === 'error') {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    const error = isRecord(params.error) ? params.error : params
    if (!turn || !isRecord(error)) {
      appendError(state, 'error references an unknown turn')
      return { scope: 'thread' }
    }
    turn.error = error
    return turnChange(params)
  }
  if (notification.method === 'turn/plan/updated') {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    if (!turn || !Array.isArray(params.plan)) {
      appendError(state, 'turn/plan/updated is incomplete')
      return { scope: 'thread' }
    }
    turn.plan = params.plan
    if (typeof params.explanation === 'string') turn.planExplanation = params.explanation
    return turnChange(params)
  }
  if (notification.method === 'turn/diff/updated') {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    if (!turn || typeof params.diff !== 'string') {
      appendError(state, 'turn/diff/updated is incomplete')
      return { scope: 'thread' }
    }
    turn.diff = params.diff
    return turnChange(params)
  }
  if (notification.method === 'item/fileChange/patchUpdated') {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    const item = turn && findItem(turn, stringValue(params.itemId) ?? '')
    if (!turn || !item || !Array.isArray(params.changes)) {
      appendError(state, 'item/fileChange/patchUpdated is incomplete')
      return { scope: 'thread' }
    }
    item.changes = params.changes
    return turnChange(params)
  }
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    const item = isRecord(params.item) ? params.item : null
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    if (!item || !stringValue(item.id) || !turn) {
      appendError(state, `${notification.method} is incomplete`)
      return { scope: 'thread' }
    }
    upsertItem(turn, withLifecycleStatus(notification.method, item))
    return turnChange(params)
  }
  if (
    notification.method === 'item/agentMessage/delta' ||
    notification.method === 'item/commandExecution/outputDelta'
  ) {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    const itemId = stringValue(params.itemId)
    const delta = stringValue(params.delta)
    if (!turn || !itemId || delta === undefined) {
      appendError(state, `${notification.method} is incomplete`)
      return { scope: 'thread' }
    }
    const item = findItem(turn, itemId) ?? {
      id: itemId,
      type: notification.method.includes('agentMessage') ? 'agentMessage' : 'commandExecution',
    }
    if (notification.method.includes('agentMessage'))
      item.text = appendBounded(stringValue(item.text) ?? '', delta)
    else item.aggregatedOutput = appendBounded(stringValue(item.aggregatedOutput) ?? '', delta)
    upsertItem(turn, item)
    return turnChange(params)
  }
  if (
    notification.method === 'item/plan/delta' ||
    notification.method === 'item/reasoning/summaryTextDelta'
  ) {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    const item = turn && findItem(turn, stringValue(params.itemId) ?? '')
    const delta = stringValue(params.delta)
    if (!item || delta === undefined) {
      appendError(state, `${notification.method} is incomplete`)
      return { scope: 'thread' }
    }
    if (notification.method === 'item/plan/delta')
      item.text = `${stringValue(item.text) ?? ''}${delta}`
    else {
      const index = typeof params.summaryIndex === 'number' ? params.summaryIndex : 0
      const summary = Array.isArray(item.summary) ? [...item.summary] : []
      summary[index] = `${stringValue(summary[index]) ?? ''}${delta}`
      item.summary = summary
    }
    return turnChange(params)
  }
  if (notification.method === 'item/reasoning/summaryPartAdded') {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    const item = turn && findItem(turn, stringValue(params.itemId) ?? '')
    if (!item) {
      appendError(state, 'item/reasoning/summaryPartAdded references an unknown item')
      return { scope: 'thread' }
    }
    return turnChange(params)
  }
  if (notification.method === 'item/mcpToolCall/progress') {
    const turn = findTurn(thread, stringValue(params.turnId) ?? '')
    const item = turn && findItem(turn, stringValue(params.itemId) ?? '')
    if (!item || typeof params.message !== 'string') {
      appendError(state, 'item/mcpToolCall/progress is incomplete')
      return { scope: 'thread' }
    }
    item.progress = params.message
    return turnChange(params)
  }
  return { scope: 'none' }
}
export function applyHistoryEvents(state: CodexThreadState, events: readonly CodexHistoryEvent[]) {
  const knownTurnIds = new Set(
    (Array.isArray(state.thread.turns) ? state.thread.turns : []).flatMap((turn) =>
      isRecord(turn) && typeof turn.id === 'string' ? [turn.id] : [],
    ),
  )
  const terminalTurnIds = new Set(
    events.flatMap((event) => {
      const params = event.message.params
      const turn = isRecord(params?.turn) ? params.turn : undefined
      return (event.message.method === 'turn/completed' ||
        event.message.method === 'turn/failed') &&
        params?.threadId === state.thread.id &&
        typeof turn?.id === 'string'
        ? [turn.id]
        : []
    }),
  )
  const replayTurnIds = new Set(
    (Array.isArray(state.thread.turns) ? state.thread.turns : []).flatMap((turn) =>
      isRecord(turn) &&
      typeof turn.id === 'string' &&
      turn.status !== 'inProgress' &&
      (!Array.isArray(turn.items) || turn.items.length === 0) &&
      terminalTurnIds.has(turn.id)
        ? [turn.id]
        : [],
    ),
  )
  for (const event of events) {
    if (!Number.isSafeInteger(event.id) || event.id < 1 || state.seenEventIds.has(String(event.id)))
      continue
    const params = event.message.params
    if (
      !isRecord(params) ||
      typeof params.threadId !== 'string' ||
      params.threadId !== state.thread.id
    )
      continue
    const method = event.message.method
    const usageEvent = method === 'thread/tokenUsage/updated'
    const item = isRecord(params.item) ? params.item : undefined
    const questionnaireEvent =
      method === 'item/tool/requestUserInput' ||
      method === 'webcodex/userInput/answered' ||
      method === 'serverRequest/resolved'
    const settingsEvent = method === 'thread/settings/updated'
    const commandEvent =
      method === 'item/commandExecution/outputDelta' ||
      ((method === 'item/started' || method === 'item/completed') &&
        item?.type === 'commandExecution')
    const assistantEvent =
      method === 'item/agentMessage/delta' ||
      ((method === 'item/started' || method === 'item/completed') && item?.type === 'agentMessage')
    const turnEvent =
      method === 'turn/started' || method === 'turn/completed' || method === 'turn/failed'
    const turnId = stringValue(params.turnId)
    const eventTurn = isRecord(params.turn) ? params.turn : undefined
    const eventTurnId = stringValue(eventTurn?.id) ?? turnId

    if (usageEvent) {
      applyCodexNotification(state, event.message, String(event.id))
      continue
    }

    // A complete native snapshot remains authoritative. Replay only fills a
    // terminal missing/sparse turn after a reload or reconnect. An active
    // sparse turn must continue through SSE so its text retains stream timing.
    if (method === 'turn/started') {
      if (!eventTurnId || knownTurnIds.has(eventTurnId) || !terminalTurnIds.has(eventTurnId))
        continue
      applyCodexNotification(state, event.message, String(event.id))
      knownTurnIds.add(eventTurnId)
      replayTurnIds.add(eventTurnId)
      continue
    }
    if (turnEvent) {
      if (!eventTurnId || !replayTurnIds.has(eventTurnId)) continue
      applyCodexNotification(state, event.message, String(event.id))
      continue
    }
    if (
      (method === 'item/tool/requestUserInput' || commandEvent || assistantEvent) &&
      (!turnId || !knownTurnIds.has(turnId))
    )
      continue
    if (assistantEvent && (!turnId || !replayTurnIds.has(turnId))) continue
    if (!questionnaireEvent && !commandEvent && !assistantEvent && !settingsEvent) continue
    applyCodexNotification(state, event.message, String(event.id))
  }
}

function isTokenUsage(value: unknown): value is CodexRecord {
  if (!isRecord(value)) return false
  if (
    value.modelContextWindow !== undefined &&
    value.modelContextWindow !== null &&
    (typeof value.modelContextWindow !== 'number' ||
      !Number.isFinite(value.modelContextWindow) ||
      value.modelContextWindow <= 0)
  )
    return false
  return isTokenUsageBreakdown(value.last) && isTokenUsageBreakdown(value.total)
}

function isTokenUsageBreakdown(value: unknown): value is CodexRecord {
  return (
    isRecord(value) &&
    ['inputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'].every(
      (field) => typeof value[field] === 'number' && Number.isFinite(value[field]),
    )
  )
}

/**
 * Completes the transient request and materializes its durable transcript summary.
 * The bridge-owned answered event carries answers that App Server's resolved event omits.
 */
function finalizeUserInput(
  state: CodexThreadState,
  requestId: unknown,
  rawAnswers?: unknown,
): CodexThreadChange {
  const request = state.userInput
  const answers = isRecord(rawAnswers) ? rawAnswers : {}
  if (!request || request.requestId !== requestId) {
    if (rawAnswers === undefined) return { scope: 'thread' }
    const existing = Object.entries(state.questionnaireSummaries ?? {}).find(
      ([, summary]) => summary.requestId === requestId,
    )
    if (!existing) return { scope: 'thread' }
    const [turnId, summary] = existing
    state.questionnaireSummaries![turnId] = {
      ...summary,
      questions: summary.questions.map((question) =>
        Object.assign({}, question, {
          answers: questionnaireAnswer(answers, question.id),
        }),
      ),
    }
    return { scope: 'turn', turnId }
  }
  state.questionnaireSummaries = {
    ...state.questionnaireSummaries,
    [request.turnId]: {
      requestId: request.requestId,
      questionCount: request.questions.length,
      questions: request.questions.map((question) => {
        const id = stringValue(question.id) ?? ''
        return {
          id,
          question: stringValue(question.question) ?? '',
          answers: questionnaireAnswer(answers, id),
        }
      }),
    },
  }
  state.userInput = undefined
  return { scope: 'turn', turnId: request.turnId }
}

function questionnaireAnswer(answers: CodexRecord, questionId: string | undefined) {
  if (!questionId) return []
  const value = isRecord(answers[questionId]) ? answers[questionId] : undefined
  return Array.isArray(value?.answers)
    ? value.answers.filter((answer): answer is string => typeof answer === 'string')
    : []
}

function appendBounded(current: string, delta: string) {
  if (current.endsWith('\n[Content truncated]')) return current
  const next = current + delta
  if (next.length <= MAX_ACCUMULATED_TEXT) return next
  const marker = '\n[Content truncated]'
  return `${next.slice(0, MAX_ACCUMULATED_TEXT - marker.length)}${marker}`
}

function upsertTurn(thread: CodexRecord, next: CodexRecord) {
  const turns = Array.isArray(thread.turns) ? [...thread.turns] : []
  const index = turns.findIndex((value) => isRecord(value) && value.id === next.id)
  if (index >= 0) {
    const previous = isRecord(turns[index]) ? turns[index] : {}
    turns[index] = mergeTurn(previous, next)
  } else turns.push(next)
  thread.turns = turns
}
function upsertItem(turn: CodexRecord, item: CodexRecord) {
  const items = Array.isArray(turn.items) ? [...turn.items] : []
  const index = items.findIndex((value) => isRecord(value) && value.id === item.id)
  if (index >= 0) items[index] = { ...(isRecord(items[index]) ? items[index] : {}), ...item }
  else items.push(item)
  turn.items = items
}

function mergeTurn(current: CodexRecord, next: CodexRecord): CodexRecord {
  const currentItems = Array.isArray(current.items) ? current.items.filter(isRecord) : []
  const nextItems = Array.isArray(next.items) ? next.items.filter(isRecord) : []
  const currentIds = new Set(
    currentItems.flatMap((item) => (typeof item.id === 'string' ? [item.id] : [])),
  )
  const nextIds = new Set(
    nextItems.flatMap((item) => (typeof item.id === 'string' ? [item.id] : [])),
  )
  const mergedNextItems = nextItems.map((item) => {
    const previous = currentItems.find((candidate) => candidate.id === item.id)
    return previous ? { ...previous, ...item } : item
  })
  const snapshotIsSparse = currentItems.some(
    (item) => typeof item.id !== 'string' || !nextIds.has(item.id),
  )
  const items = snapshotIsSparse
    ? currentItems.map((item) => {
        const nextItem = nextItems.find((candidate) => candidate.id === item.id)
        return nextItem ? { ...item, ...nextItem } : item
      })
    : mergedNextItems
  items.push(
    ...(snapshotIsSparse
      ? nextItems.filter((item) => typeof item.id !== 'string' || !currentIds.has(item.id))
      : currentItems.filter((item) => typeof item.id !== 'string' || !nextIds.has(item.id))),
  )
  return {
    ...current,
    ...next,
    ...(Array.isArray(current.items) || Array.isArray(next.items) ? { items } : {}),
  }
}

function withLifecycleStatus(method: string, item: CodexRecord) {
  if (item.type !== 'contextCompaction') return item
  return { ...item, status: method === 'item/started' ? 'inProgress' : 'completed' }
}
function findTurn(thread: CodexRecord, id: string) {
  return (Array.isArray(thread.turns) ? thread.turns : []).find(
    (value): value is CodexRecord => isRecord(value) && value.id === id,
  )
}
function findItem(turn: CodexRecord, id: string) {
  return (Array.isArray(turn.items) ? turn.items : []).find(
    (value): value is CodexRecord => isRecord(value) && value.id === id,
  )
}
function inProgressTurn(thread: CodexRecord) {
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  const turn = [...turns]
    .reverse()
    .find((value) => isRecord(value) && value.status === 'inProgress')
  return isRecord(turn) ? stringValue(turn.id) : undefined
}
export function interruptUserInput(state: CodexThreadState): CodexThreadChange {
  const request = state.userInput
  if (!request) return { scope: 'none' }
  const turn = findTurn(state.thread, request.turnId)
  if (turn) turn.status = 'interrupted'
  state.userInput = undefined
  state.questionnaireSummaries = {
    ...state.questionnaireSummaries,
    [request.turnId]: {
      requestId: request.requestId,
      questionCount: request.questions.length,
      questions: request.questions.map((question) => ({
        id: stringValue(question.id),
        question: stringValue(question.question) ?? '',
        answers: [],
      })),
    },
  }
  return { scope: 'turn', turnId: request.turnId }
}

function turnChange(params: CodexRecord): CodexThreadChange {
  const turnId = stringValue(params.turnId)
  return turnId ? { scope: 'turn', turnId } : { scope: 'thread' }
}

function appendError(state: CodexThreadState, message: string) {
  if (!state.protocolErrors.includes(message))
    state.protocolErrors = [...state.protocolErrors, message].slice(-20)
}
function isRecord(value: unknown): value is CodexRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}
function safeCode(value: unknown) {
  return typeof value === 'string' && value ? value : 'invalid-message'
}
function validRequestId(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}
