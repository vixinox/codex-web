import type { ConversationChange, ConversationSnapshot } from '@codex-web/conversation'

type Check = (value: unknown) => boolean

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
const text = (value: unknown) => typeof value === 'string'
const id = (value: unknown) =>
  typeof value === 'string' &&
  value.length <= 512 &&
  value.trim().length > 0 &&
  !['__proto__', 'constructor', 'prototype'].includes(value)
const date = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value))
const sequence = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const boolean = (value: unknown) => typeof value === 'boolean'
const literal =
  (...values: string[]): Check =>
  (value) =>
    typeof value === 'string' && values.includes(value)
const optional =
  (check: Check): Check =>
  (value) =>
    value === undefined || check(value)
const array =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check)
const shape =
  (fields: Record<string, Check>): Check =>
  (value) =>
    record(value) &&
    Object.keys(value).every((key) => Object.hasOwn(fields, key)) &&
    Object.entries(fields).every(([key, check]) =>
      check(Object.hasOwn(value, key) ? value[key] : undefined),
    )
const dictionary =
  (check: Check, keyField?: string): Check =>
  (value) =>
    record(value) &&
    Object.entries(value).every(
      ([key, entry]) =>
        id(key) &&
        check(entry) &&
        (keyField === undefined || (record(entry) && entry[keyField] === key)),
    )
const variant =
  (field: string, cases: Record<string, Check>): Check =>
  (value) => {
    if (!record(value)) return false
    const tag = value[field]
    return typeof tag === 'string' && Object.hasOwn(cases, tag) && cases[tag](value)
  }

function json(value: unknown, depth = 0): boolean {
  if (depth > 24) return false
  if (value === null || text(value) || boolean(value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((entry) => json(entry, depth + 1))
  return (
    record(value) &&
    Object.entries(value).every(([key, entry]) => id(key) && json(entry, depth + 1))
  )
}

const identity = shape({
  sourceId: id,
  sourceEventId: id,
  deliveryEventId: optional(id),
  applicationSequence: optional(sequence),
  occurredAt: optional(date),
  receivedAt: date,
})
const conversationStatus = literal('active', 'idle', 'archived', 'deleted')
const turnStatus = literal('queued', 'inProgress', 'completed', 'failed', 'cancelled')
const messageStatus = literal('inProgress', 'completed', 'interrupted', 'failed')
const activityStatus = literal('pending', 'inProgress', 'completed', 'failed', 'cancelled')
const interactionKind = literal('approval', 'userInput', 'elicitation', 'toolCall', 'other')

const part = variant('type', {
  text: shape({ type: literal('text'), id, text }),
  image: shape({ type: literal('image'), id, resourceId: id, alt: optional(text) }),
  audio: shape({ type: literal('audio'), id, resourceId: id, transcript: optional(text) }),
  file: shape({ type: literal('file'), id, resourceId: id, name: optional(text) }),
  structured: shape({ type: literal('structured'), id, mediaType: id, value: json }),
})
const boundedText =
  (limit: number): Check =>
  (value) =>
    typeof value === 'string' && value.length <= limit
const plan = shape({
  steps: (value) =>
    Array.isArray(value) &&
    value.length <= 128 &&
    value.every(
      shape({
        step: boundedText(2000),
        status: literal('pending', 'inProgress', 'completed'),
      }),
    ),
  explanation: optional(boundedText(16000)),
})
const diff = boundedText(32000)
const usageBreakdown = shape({
  inputTokens: sequence,
  cachedInputTokens: sequence,
  outputTokens: sequence,
  reasoningOutputTokens: sequence,
  totalTokens: sequence,
  cacheWriteInputTokens: optional(sequence),
})
const tokenUsage = shape({
  last: usageBreakdown,
  total: usageBreakdown,
  modelContextWindow: (value) => value === null || sequence(value),
})
const turn = shape({
  id,
  status: turnStatus,
  messageIds: array(id),
  activityIds: array(id),
  itemOrder: optional(array(shape({ type: literal('message', 'activity'), id }))),
  durationMs: optional(sequence),
  plan: optional(plan),
  diff: optional(diff),
  startedAt: optional(date),
  completedAt: optional(date),
  failureCode: optional(id),
})
const message = shape({
  id,
  turnId: id,
  role: literal('user', 'assistant', 'system', 'tool'),
  phase: optional(literal('commentary', 'final_answer')),
  status: messageStatus,
  parts: array(part),
  createdAt: optional(date),
  completedAt: optional(date),
})
const activity = shape({
  id,
  turnId: id,
  kind: literal(
    'hookPrompt',
    'agentMessage',
    'functionCallOutput',
    'plan',
    'reasoning',
    'commandExecution',
    'fileChange',
    'mcpToolCall',
    'dynamicToolCall',
    'collabAgentToolCall',
    'subAgentActivity',
    'webSearch',
    'imageView',
    'sleep',
    'imageGeneration',
    'enteredReviewMode',
    'exitedReviewMode',
    'contextCompaction',
    'realtimeSession',
    'realtimeTranscript',
    'realtimePromotion',
    'realtimeAudio',
    'other',
  ),
  status: activityStatus,
  title: optional(text),
  output: optional(text),
  command: optional(text),
  commandStatus: optional(literal('inProgress', 'completed', 'failed', 'declined')),
  exitCode: optional((value) => typeof value === 'number' && Number.isSafeInteger(value)),
  durationMs: optional(sequence),
  changes: optional(
    array(
      shape({
        path: text,
        kind: literal('add', 'delete', 'update'),
        movePath: optional(text),
        diff: optional(text),
      }),
    ),
  ),
  truncated: optional(boolean),
  startedAt: optional(date),
  completedAt: optional(date),
})
const outcome = variant('kind', {
  approved: shape({ kind: literal('approved') }),
  rejected: shape({ kind: literal('rejected') }),
  answers: shape({ kind: literal('answers'), answers: dictionary(array(text)) }),
  submitted: shape({ kind: literal('submitted'), value: json }),
  dismissed: shape({ kind: literal('dismissed'), reason: optional(text) }),
})
const details = variant('kind', {
  approval: shape({
    kind: literal('approval'),
    choices: array(shape({ id, label: text })),
    reason: optional(text),
  }),
  userInput: shape({
    kind: literal('userInput'),
    blocking: boolean,
    questions: array(
      shape({
        id,
        prompt: text,
        isSecret: optional(boolean),
        options: optional(array(shape({ id, label: text, description: optional(text) }))),
      }),
    ),
  }),
  elicitation: shape({
    kind: literal('elicitation'),
    message: optional(text),
    form: optional(json),
  }),
  toolCall: shape({ kind: literal('toolCall'), name: text, arguments: optional(json) }),
  other: shape({ kind: literal('other'), summary: optional(text) }),
})
const interaction = shape({
  id,
  turnId: id,
  kind: interactionKind,
  activityId: optional(id),
  status: literal('pending', 'resolved', 'cancelled', 'expired'),
  requestCorrelation: optional((value) => id(value) || sequence(value)),
  details: optional(details),
  outcome: optional(outcome),
  createdAt: optional(date),
  resolvedAt: optional(date),
})
const link = shape({
  id,
  parentConversationId: id,
  parentAgentId: optional(id),
  childAgentId: optional(id),
  childConversationId: optional(id),
  childSourceId: optional(id),
  turnId: optional(id),
  activityId: optional(id),
  task: optional(text),
  status: literal('pending', 'running', 'completed', 'failed', 'cancelled'),
})
const diagnostic = shape({ code: id, sourceId: id, summary: text, identity })

const snapshot = shape({
  id,
  status: conversationStatus,
  title: optional(text),
  tokenUsage: optional(tokenUsage),
  watermark: sequence,
  turns: dictionary(turn, 'id'),
  messages: dictionary(message, 'id'),
  activities: dictionary(activity, 'id'),
  interactions: dictionary(interaction, 'id'),
  agentLinks: dictionary(link, 'id'),
  diagnostics: array(diagnostic),
})

const changeShape = (type: ConversationChange['type'], fields: Record<string, Check>): Check =>
  shape({ type: literal(type), identity, ...fields })

const change = variant('type', {
  'conversation.updated': changeShape('conversation.updated', {
    conversationId: id,
    status: optional(conversationStatus),
    title: optional(text),
    tokenUsage: optional(tokenUsage),
  }),
  'turn.upserted': changeShape('turn.upserted', { turn }),
  'turn.statusChanged': changeShape('turn.statusChanged', { turnId: id, status: turnStatus }),
  'turn.planUpdated': changeShape('turn.planUpdated', { turnId: id, plan }),
  'turn.diffUpdated': changeShape('turn.diffUpdated', { turnId: id, diff }),
  'message.upserted': changeShape('message.upserted', { message }),
  'message.partAdded': changeShape('message.partAdded', { messageId: id, part }),
  'message.textDelta': changeShape('message.textDelta', { messageId: id, partId: id, delta: text }),
  'message.statusChanged': changeShape('message.statusChanged', {
    messageId: id,
    status: messageStatus,
    completedAt: optional(date),
  }),
  'activity.upserted': changeShape('activity.upserted', { activity }),
  'activity.statusChanged': changeShape('activity.statusChanged', {
    activityId: id,
    status: activityStatus,
    completedAt: optional(date),
  }),
  'activity.outputDelta': changeShape('activity.outputDelta', { activityId: id, delta: text }),
  'interaction.opened': changeShape('interaction.opened', { interaction }),
  'interaction.resolved': changeShape('interaction.resolved', {
    interactionId: id,
    outcome,
    resolvedAt: optional(date),
  }),
  'interaction.cancelled': changeShape('interaction.cancelled', {
    interactionId: id,
    status: literal('cancelled', 'expired'),
    resolvedAt: optional(date),
  }),
  'agentLink.upserted': changeShape('agentLink.upserted', { link }),
  diagnostic: changeShape('diagnostic', { diagnostic }),
} satisfies Record<ConversationChange['type'], Check>)

export function isConversationSnapshot(value: unknown): value is ConversationSnapshot {
  return snapshot(value)
}

export function isConversationChange(value: unknown): value is ConversationChange {
  return change(value)
}
