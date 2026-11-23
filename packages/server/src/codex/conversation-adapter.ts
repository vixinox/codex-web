import { createHash } from 'node:crypto'
import {
  createConversationSnapshot,
  type Activity,
  type ActivityId,
  type AgentLink,
  type ConversationChange,
  type ConversationId,
  type ConversationSnapshot,
  type EventIdentity,
  type FileChange,
  type Interaction,
  type InteractionId,
  type Message,
  type MessageId,
  type MessagePart,
  type MessagePartId,
  type SourceEventId,
  type SourceId,
  type TokenUsage,
  type TokenUsageBreakdown,
  type Turn,
  type TurnId,
  type TurnItemRef,
  type TurnPlan,
} from '@codex-web/conversation'

const codexSource = 'codex-app-server' as SourceId

export function isCodexInteractionRequest(method: string) {
  return (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval' ||
    method === 'item/tool/requestUserInput'
  )
}

const fileChangeDecisions = ['accept', 'acceptForSession', 'decline', 'cancel'] as const

export function isFileChangeDecision(
  value: unknown,
): value is (typeof fileChangeDecisions)[number] {
  return fileChangeDecisions.some((decision) => decision === value)
}

export function adaptCodexSnapshot(
  value: unknown,
  watermark: number,
  receivedAt = new Date().toISOString(),
): ConversationSnapshot | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  const snapshot = createConversationSnapshot(value.id as ConversationId, watermark)
  const title = contentText(value.name ?? value.preview)
  if (title !== undefined) snapshot.title = title
  const tokenUsage = projectTokenUsage(value.tokenUsage)
  if (tokenUsage) snapshot.tokenUsage = tokenUsage
  snapshot.status =
    value.status === 'active' || (isRecord(value.status) && value.status.type === 'active')
      ? 'active'
      : 'idle'
  if (!Array.isArray(value.turns)) return snapshot

  for (const entry of value.turns) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    const itemOrder: TurnItemRef[] = []
    const turn: Turn = {
      id: entry.id as TurnId,
      status: turnStatus(entry.status),
      messageIds: [],
      activityIds: [],
      itemOrder,
      ...turnDetails(entry),
    }
    snapshot.turns[turn.id] = turn
    if (!Array.isArray(entry.items)) continue
    for (const rawItem of entry.items) {
      if (!isRecord(rawItem) || typeof rawItem.id !== 'string') continue
      const identity: EventIdentity = {
        sourceId: codexSource,
        sourceEventId: `snapshot:${rawItem.id}` as SourceEventId,
        receivedAt,
      }
      for (const change of adaptItem(rawItem, turn.id, identity, false, snapshot.id)) {
        if (change.type === 'message.upserted') {
          snapshot.messages[change.message.id] = change.message
          if (turn.messageIds.includes(change.message.id)) continue
          turn.messageIds.push(change.message.id)
          itemOrder.push({ type: 'message', id: change.message.id })
        } else if (change.type === 'activity.upserted') {
          snapshot.activities[change.activity.id] = change.activity
          if (turn.activityIds.includes(change.activity.id)) continue
          turn.activityIds.push(change.activity.id)
          itemOrder.push({ type: 'activity', id: change.activity.id })
        } else if (change.type === 'agentLink.upserted') {
          snapshot.agentLinks[change.link.id] = change.link
        }
      }
    }
  }
  return snapshot
}

export function adaptCodexNotification(
  method: string,
  params: Record<string, unknown>,
  identity: EventIdentity,
): ConversationChange[] {
  const eventHash = createHash('sha256')
    .update(JSON.stringify(identity.sourceEventId))
    .digest('hex')
  const changes: ConversationChange[] = []
  for (const [index, change] of mapCodexNotification(method, params, identity).entries()) {
    const mappedIdentity = {
      ...change.identity,
      sourceEventId: `codex:${eventHash}:${index}` as SourceEventId,
    }
    changes.push(
      change.type === 'diagnostic'
        ? {
            ...change,
            identity: mappedIdentity,
            diagnostic: { ...change.diagnostic, identity: mappedIdentity },
          }
        : { ...change, identity: mappedIdentity },
    )
  }
  return changes
}

function mapCodexNotification(
  method: string,
  params: Record<string, unknown>,
  identity: EventIdentity,
): ConversationChange[] {
  const conversationId = text(params.threadId) as ConversationId | undefined
  if (!conversationId) return [diagnostic(identity, 'MISSING_CONVERSATION_ID')]
  const turnValue = isRecord(params.turn) ? params.turn : undefined
  const turnId = (text(params.turnId) ?? text(turnValue?.id)) as TurnId | undefined

  if (
    (method === 'turn/started' || method === 'turn/completed' || method === 'turn/failed') &&
    turnValue &&
    turnId
  ) {
    const status =
      method === 'turn/started'
        ? 'inProgress'
        : method === 'turn/completed'
          ? turnStatus(turnValue.status)
          : 'failed'
    const turn: Turn = {
      id: turnId,
      status,
      messageIds: [],
      activityIds: [],
      itemOrder: [],
      ...turnDetails(turnValue),
    }
    return [{ type: 'turn.upserted', identity, turn }]
  }
  if (method === 'turn/plan/updated' && turnId) {
    const plan = projectPlan(params.plan, params.explanation)
    return plan
      ? [{ type: 'turn.planUpdated', identity, turnId, plan }]
      : [diagnostic(identity, 'INVALID_TURN_PLAN')]
  }
  if (method === 'turn/diff/updated' && turnId) {
    const diff = contentText(params.diff)
    return diff === undefined
      ? [diagnostic(identity, 'INVALID_TURN_DIFF')]
      : [{ type: 'turn.diffUpdated', identity, turnId, diff }]
  }
  if (method === 'thread/tokenUsage/updated') {
    const tokenUsage = projectTokenUsage(params.tokenUsage)
    return tokenUsage
      ? [{ type: 'conversation.updated', identity, conversationId, tokenUsage }]
      : [diagnostic(identity, 'INVALID_TOKEN_USAGE')]
  }
  if (method === 'item/started' || method === 'item/completed') {
    if (!isRecord(params.item) || !text(params.item.id) || !turnId)
      return [diagnostic(identity, 'INVALID_ITEM_LIFECYCLE')]
    const timestampKey = method === 'item/started' ? 'startedAtMs' : 'completedAtMs'
    const timestamp = time(params[timestampKey])
    return adaptItem(
      timestamp ? { ...params.item, [timestampKey]: params[timestampKey] } : params.item,
      turnId,
      identity,
      method === 'item/started',
      conversationId,
      method === 'item/completed',
    )
  }
  if (method === 'item/fileChange/patchUpdated') {
    const itemId = activityNotificationId(params.itemId)
    if (!turnId || !itemId || !Array.isArray(params.changes))
      return [diagnostic(identity, 'INVALID_FILE_PATCH')]
    const changes = params.changes.flatMap(projectFileChange)
    if (changes.length !== params.changes.length)
      return [diagnostic(identity, 'INVALID_FILE_PATCH')]
    return [
      {
        type: 'activity.upserted',
        identity,
        activity: { id: itemId, turnId, kind: 'fileChange', status: 'inProgress', changes },
      },
    ]
  }
  if (method === 'item/reasoning/textDelta') return []
  const kind = outputDeltaKind(method)
  if (kind) {
    const itemId = activityNotificationId(params.itemId)
    const partAdded = method === 'item/reasoning/summaryPartAdded'
    const summaryIndex = kind === 'reasoning' ? nonnegativeInteger(params.summaryIndex) : 0
    const delta = partAdded ? '' : params.delta
    if (!turnId || !itemId || typeof delta !== 'string' || summaryIndex === undefined)
      return [diagnostic(identity, 'INVALID_ACTIVITY_DELTA')]
    if (summaryIndex !== 0) return []
    return [
      {
        type: 'activity.upserted',
        identity,
        activity: { id: itemId, turnId, kind, status: 'inProgress' },
      },
      ...(delta
        ? [{ type: 'activity.outputDelta' as const, identity, activityId: itemId, delta }]
        : []),
    ]
  }
  if (method === 'item/agentMessage/delta' && turnId) {
    const itemId = text(params.itemId)
    const delta = params.delta
    if (!itemId || typeof delta !== 'string') return [diagnostic(identity, 'INVALID_MESSAGE_DELTA')]
    const messageId = itemId as MessageId
    const partId = `${itemId}:text:0` as MessagePartId
    return [
      {
        type: 'message.upserted',
        identity,
        message: {
          id: messageId,
          turnId,
          role: 'assistant',
          status: 'inProgress',
          parts: [{ id: partId, type: 'text', text: '' }],
        },
      },
      { type: 'message.textDelta', identity, messageId, partId, delta },
    ]
  }
  if (isCodexInteractionRequest(method)) {
    const requestId = params.requestId
    const itemId = text(params.itemId)
    const fileChange = method === 'item/fileChange/requestApproval'
    if (
      !turnId ||
      (typeof requestId !== 'string' && typeof requestId !== 'number') ||
      (fileChange && (!itemId || params.grantRoot != null))
    )
      return [diagnostic(identity, 'INVALID_INTERACTION_REQUEST')]
    const approval = method !== 'item/tool/requestUserInput'
    const interaction: Interaction = {
      id: `request:${String(requestId)}` as InteractionId,
      turnId,
      kind: approval ? 'approval' : 'userInput',
      status: 'pending',
      ...(itemId ? { activityId: itemId as ActivityId } : {}),
      ...(approval
        ? {
            details: {
              kind: 'approval' as const,
              ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
              choices: fileChange
                ? fileChangeDecisions.map((decision) => ({ id: decision, label: decision }))
                : approvalChoices(params),
            },
          }
        : {
            details: {
              kind: 'userInput' as const,
              questions: userQuestions(params),
              blocking: params.isBlocking !== false,
            },
          }),
      createdAt: identity.occurredAt ?? identity.receivedAt,
    }
    return [{ type: 'interaction.opened', identity, interaction }]
  }
  if (method === 'thread/archived')
    return [{ type: 'conversation.updated', identity, conversationId, status: 'archived' }]
  return [diagnostic(identity, 'UNSUPPORTED_CONVERSATION_EVENT')]
}

function activityNotificationId(value: unknown): ActivityId | undefined {
  return typeof value === 'string' &&
    value.length <= 512 &&
    value.trim() &&
    !['__proto__', 'constructor', 'prototype'].includes(value)
    ? (value as ActivityId)
    : undefined
}

function outputDeltaKind(method: string): Activity['kind'] | undefined {
  switch (method) {
    case 'item/commandExecution/outputDelta':
      return 'commandExecution'
    case 'item/fileChange/outputDelta':
      return 'fileChange'
    case 'item/plan/delta':
      return 'plan'
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/summaryPartAdded':
      return 'reasoning'
  }
}

function adaptItem(
  item: Record<string, unknown>,
  turnId: TurnId,
  identity: EventIdentity,
  started = false,
  parentConversationId?: ConversationId,
  completed = false,
): ConversationChange[] {
  const id = item.id as string
  const type = text(item.type) ?? 'unknown'
  const status =
    item.status === 'failed'
      ? 'failed'
      : started || (!completed && item.status === 'inProgress')
        ? 'inProgress'
        : 'completed'
  if (type === 'userMessage' || type === 'agentMessage') {
    const content =
      type === 'agentMessage' && typeof item.text === 'string'
        ? [{ type: 'text', text: item.text }]
        : Array.isArray(item.content)
          ? item.content
          : []
    const parts: MessagePart[] = []
    for (const [index, part] of content.entries()) {
      if (!isRecord(part)) continue
      if (part.type === 'text' && typeof part.text === 'string')
        parts.push({
          id: `${id}:text:${index}` as MessagePartId,
          type: 'text',
          text: part.text,
        })
      else if (part.type === 'image')
        parts.push({
          id: `${id}:image:${index}` as MessagePartId,
          type: 'image',
          resourceId: `${id}:image:${index}`,
        })
      else if (part.type === 'audio')
        parts.push({
          id: `${id}:audio:${index}` as MessagePartId,
          type: 'audio',
          resourceId: `${id}:audio:${index}`,
        })
    }
    const message: Message = {
      id: id as MessageId,
      turnId,
      role: type === 'userMessage' ? 'user' : 'assistant',
      status,
      parts,
      ...(type === 'agentMessage' && (item.phase === 'commentary' || item.phase === 'final_answer')
        ? { phase: item.phase }
        : {}),
      ...(time(item.startedAtMs) ? { createdAt: time(item.startedAtMs) } : {}),
      ...(time(item.completedAtMs) ? { completedAt: time(item.completedAtMs) } : {}),
    }
    return [{ type: 'message.upserted', identity, message }]
  }
  const rawOutput =
    type === 'commandExecution'
      ? item.aggregatedOutput
      : type === 'reasoning'
        ? Array.isArray(item.summary)
          ? item.summary.filter((entry) => typeof entry === 'string').join('\n')
          : undefined
        : (item.text ?? item.query ?? item.progress)
  const output =
    typeof rawOutput === 'string' && (!started || rawOutput !== '') ? rawOutput : undefined
  const command = type === 'commandExecution' ? contentText(item.command) : undefined
  const commandStatus =
    type === 'commandExecution' &&
    (item.status === 'inProgress' ||
      item.status === 'completed' ||
      item.status === 'failed' ||
      item.status === 'declined')
      ? item.status
      : undefined
  const exitCode =
    type === 'commandExecution' &&
    typeof item.exitCode === 'number' &&
    Number.isSafeInteger(item.exitCode)
      ? item.exitCode
      : undefined
  const durationMs = nonnegativeInteger(item.durationMs)
  const fileChanges =
    type === 'fileChange' && Array.isArray(item.changes) && (!started || item.changes.length > 0)
      ? item.changes.flatMap(projectFileChange)
      : undefined
  const kinds = new Set<Activity['kind']>([
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
  ])
  const activity: Activity = {
    id: id as ActivityId,
    turnId,
    kind: kinds.has(type as Activity['kind']) ? (type as Activity['kind']) : 'other',
    status: item.status === 'declined' ? 'cancelled' : status,
    ...(output === undefined ? {} : { output }),
    ...(command === undefined ? {} : { command }),
    ...(commandStatus === undefined ? {} : { commandStatus }),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(fileChanges === undefined ? {} : { changes: fileChanges }),
    ...(item.commandTruncated === true || item.aggregatedOutputTruncated === true
      ? { truncated: true }
      : {}),
    ...(time(item.startedAtMs) ? { startedAt: time(item.startedAtMs) } : {}),
    ...(time(item.completedAtMs) ? { completedAt: time(item.completedAtMs) } : {}),
  }
  const changes: ConversationChange[] = [{ type: 'activity.upserted', identity, activity }]
  if (type === 'collabAgentToolCall') {
    const senderThreadId = text(item.senderThreadId)
    const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []
    for (const receiver of receivers) {
      if (typeof receiver !== 'string') continue
      const link: AgentLink = {
        id: `${id}:agent:${receiver}`,
        parentConversationId: (parentConversationId ?? senderThreadId) as ConversationId,
        childConversationId: receiver as ConversationId,
        turnId,
        activityId: id as ActivityId,
        status: activity.status === 'completed' ? 'completed' : 'running',
      }
      changes.push({ type: 'agentLink.upserted', identity, link })
    }
  } else if (type === 'subAgentActivity' && text(item.agentThreadId)) {
    changes.push({
      type: 'agentLink.upserted',
      identity,
      link: {
        id: `${id}:agent`,
        parentConversationId: parentConversationId as ConversationId,
        childConversationId: item.agentThreadId as ConversationId,
        turnId,
        activityId: id as ActivityId,
        status: activity.status === 'completed' ? 'completed' : 'running',
      },
    })
  }
  return changes
}

function nonnegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function turnDetails(value: Record<string, unknown>) {
  const startedAt =
    time(value.startedAtMs) ??
    (typeof value.startedAt === 'number' ? time(value.startedAt * 1000) : undefined)
  const completedAt =
    time(value.completedAtMs) ??
    (typeof value.completedAt === 'number' ? time(value.completedAt * 1000) : undefined)
  const durationMs = nonnegativeInteger(value.durationMs)
  const plan = projectPlan(value.plan, value.planExplanation)
  const diff = contentText(value.diff)
  const failure = projectTurnFailure(value.error)
  return {
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(plan ? { plan } : {}),
    ...(diff === undefined ? {} : { diff }),
    ...(failure ? { failure } : {}),
  }
}

function projectTurnFailure(value: unknown): { message: string; details?: string } | undefined {
  if (!isRecord(value) || typeof value.message !== 'string' || !value.message) return undefined
  const details = JSON.stringify(value, null, 2)
  return {
    message: value.message,
    ...(details && details !== JSON.stringify({ message: value.message }, null, 2)
      ? { details }
      : {}),
  }
}

function projectPlan(value: unknown, rawExplanation: unknown): TurnPlan | undefined {
  if (!Array.isArray(value)) return undefined
  const steps: TurnPlan['steps'] = []
  for (const entry of value) {
    if (!isRecord(entry)) return undefined
    const step = contentText(entry.step)
    const status = entry.status
    if (
      step === undefined ||
      (status !== 'pending' && status !== 'inProgress' && status !== 'completed')
    )
      return undefined
    steps.push({ step, status })
  }
  const explanation = contentText(rawExplanation)
  return { steps, ...(explanation === undefined ? {} : { explanation }) }
}

function projectTokenBreakdown(value: unknown): TokenUsageBreakdown | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = nonnegativeInteger(value.inputTokens)
  const cachedInputTokens = nonnegativeInteger(value.cachedInputTokens)
  const outputTokens = nonnegativeInteger(value.outputTokens)
  const reasoningOutputTokens = nonnegativeInteger(value.reasoningOutputTokens)
  const totalTokens = nonnegativeInteger(value.totalTokens)
  const cacheWriteInputTokens = nonnegativeInteger(value.cacheWriteInputTokens)
  if (
    inputTokens === undefined ||
    cachedInputTokens === undefined ||
    outputTokens === undefined ||
    reasoningOutputTokens === undefined ||
    totalTokens === undefined
  )
    return undefined
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    ...(cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens }),
  }
}

function projectTokenUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined
  const last = projectTokenBreakdown(value.last)
  const total = projectTokenBreakdown(value.total)
  const modelContextWindow =
    value.modelContextWindow == null ? null : nonnegativeInteger(value.modelContextWindow)
  return last && total && modelContextWindow !== undefined
    ? { last, total, modelContextWindow }
    : undefined
}

function projectFileChange(value: unknown): FileChange[] {
  if (!isRecord(value) || !isRecord(value.kind)) return []
  const path = contentText(value.path)
  const kind = value.kind.type
  if (!path || (kind !== 'add' && kind !== 'delete' && kind !== 'update')) return []
  const movePath = kind === 'update' ? contentText(value.kind.move_path) : undefined
  const diff = contentText(value.diff)
  return [
    { path, kind, ...(movePath ? { movePath } : {}), ...(diff === undefined ? {} : { diff }) },
  ]
}

function approvalChoices(params: Record<string, unknown>) {
  const choices = Array.isArray(params.availableDecisions) ? params.availableDecisions : []
  return choices.flatMap((choice, index) => {
    if (typeof choice === 'string') return [{ id: choice, label: choice }]
    return isRecord(choice) && typeof choice.label === 'string'
      ? [{ id: text(choice.id) ?? `choice-${index}`, label: choice.label }]
      : []
  })
}

function userQuestions(params: Record<string, unknown>) {
  if (!Array.isArray(params.questions)) return []
  return params.questions.flatMap((question, index) => {
    if (!isRecord(question)) return []
    const prompt = text(question.question)
    if (!prompt) return []
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option, optionIndex) => {
          if (typeof option === 'string') return [{ id: `option-${optionIndex}`, label: option }]
          return isRecord(option) && typeof option.label === 'string'
            ? [
                {
                  id: text(option.id) ?? `option-${optionIndex}`,
                  label: option.label,
                  ...(text(option.description)
                    ? { description: text(option.description) as string }
                    : {}),
                },
              ]
            : []
        })
      : undefined
    return [
      {
        id: text(question.id) ?? `question-${index}`,
        prompt: prompt,
        ...(options ? { options } : {}),
        ...(typeof question.isSecret === 'boolean' ? { isSecret: question.isSecret } : {}),
      },
    ]
  })
}

function diagnostic(identity: EventIdentity, code: string): ConversationChange {
  return {
    type: 'diagnostic',
    identity,
    diagnostic: { code, sourceId: identity.sourceId, summary: code, identity },
  }
}
function turnStatus(value: unknown): Turn['status'] {
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  if (value === 'interrupted' || value === 'cancelled') return 'cancelled'
  return value === 'inProgress' ? 'inProgress' : 'queued'
}
function time(value: unknown) {
  if (typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 0 &&
    date.getUTCFullYear() <= 9999
    ? date.toISOString()
    : undefined
}
function contentText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function text(value: unknown) {
  return typeof value === 'string' && value.length ? value : undefined
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
