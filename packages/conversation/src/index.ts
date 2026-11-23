export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type ConversationId = Brand<string, 'ConversationId'>
export type TurnId = Brand<string, 'TurnId'>
export type MessageId = Brand<string, 'MessageId'>
export type MessagePartId = Brand<string, 'MessagePartId'>
export type ActivityId = Brand<string, 'ActivityId'>
export type InteractionId = Brand<string, 'InteractionId'>
export type AgentId = Brand<string, 'AgentId'>
export type SourceId = Brand<string, 'SourceId'>
export type SourceEventId = Brand<string, 'SourceEventId'>
export type DeliveryEventId = Brand<string, 'DeliveryEventId'>
export type RuntimeRequestId = Brand<string | number, 'RuntimeRequestId'>

export type EventIdentity = {
  sourceId: SourceId
  sourceEventId: SourceEventId
  deliveryEventId?: DeliveryEventId
  applicationSequence?: number
  occurredAt?: string
  receivedAt: string
}

export type ConversationStatus = 'active' | 'idle' | 'archived' | 'deleted'
export type TurnStatus = 'queued' | 'inProgress' | 'completed' | 'failed' | 'cancelled'
export type ActivityStatus = 'pending' | 'inProgress' | 'completed' | 'failed' | 'cancelled'
export type InteractionStatus = 'pending' | 'resolved' | 'cancelled' | 'expired'

export type TextPart = { id: MessagePartId; type: 'text'; text: string }
export type ImagePart = { id: MessagePartId; type: 'image'; resourceId: string; alt?: string }
export type AudioPart = {
  id: MessagePartId
  type: 'audio'
  resourceId: string
  transcript?: string
}
export type FilePart = { id: MessagePartId; type: 'file'; resourceId: string; name?: string }
export type StructuredPart = {
  id: MessagePartId
  type: 'structured'
  mediaType: string
  value: JsonValue
}
export type MessagePart = TextPart | ImagePart | AudioPart | FilePart | StructuredPart
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type Message = {
  id: MessageId
  turnId: TurnId
  role: 'user' | 'assistant' | 'system' | 'tool'
  phase?: 'commentary' | 'final_answer'
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed'
  parts: MessagePart[]
  createdAt?: string
  completedAt?: string
}

export type TurnItemRef = { type: 'message'; id: MessageId } | { type: 'activity'; id: ActivityId }

export type Turn = {
  id: TurnId
  status: TurnStatus
  messageIds: MessageId[]
  activityIds: ActivityId[]
  itemOrder?: TurnItemRef[]
  durationMs?: number
  plan?: TurnPlan
  diff?: string
  startedAt?: string
  completedAt?: string
  failureCode?: string
  failure?: { message: string; details?: string }
}

export type TurnPlan = {
  steps: { step: string; status: 'pending' | 'inProgress' | 'completed' }[]
  explanation?: string
}

export type TokenUsageBreakdown = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  cacheWriteInputTokens?: number
}

export type TokenUsage = {
  last: TokenUsageBreakdown
  total: TokenUsageBreakdown
  modelContextWindow: number | null
}

export type Activity = {
  id: ActivityId
  turnId: TurnId
  kind: ActivityKind
  status: ActivityStatus
  title?: string
  output?: string
  command?: string
  commandStatus?: 'inProgress' | 'completed' | 'failed' | 'declined'
  exitCode?: number
  durationMs?: number
  changes?: FileChange[]
  truncated?: boolean
  startedAt?: string
  completedAt?: string
}

export type FileChange = {
  path: string
  kind: 'add' | 'delete' | 'update'
  movePath?: string
  diff?: string
}

export type ActivityKind =
  | 'hookPrompt'
  | 'agentMessage'
  | 'functionCallOutput'
  | 'plan'
  | 'reasoning'
  | 'commandExecution'
  | 'fileChange'
  | 'mcpToolCall'
  | 'dynamicToolCall'
  | 'collabAgentToolCall'
  | 'subAgentActivity'
  | 'webSearch'
  | 'imageView'
  | 'sleep'
  | 'imageGeneration'
  | 'enteredReviewMode'
  | 'exitedReviewMode'
  | 'contextCompaction'
  | 'realtimeSession'
  | 'realtimeTranscript'
  | 'realtimePromotion'
  | 'realtimeAudio'
  | 'other'

export type InteractionOutcome =
  | { kind: 'approved' }
  | { kind: 'rejected' }
  | { kind: 'answers'; answers: Record<string, string[]> }
  | { kind: 'submitted'; value: JsonValue }
  | { kind: 'dismissed'; reason?: string }

export type Interaction = {
  id: InteractionId
  turnId: TurnId
  activityId?: ActivityId
  kind: 'approval' | 'userInput' | 'elicitation' | 'toolCall' | 'other'
  status: InteractionStatus
  requestCorrelation?: RuntimeRequestId
  details?: InteractionDetails
  outcome?: InteractionOutcome
  createdAt?: string
  resolvedAt?: string
}

export type InteractionDetails =
  | { kind: 'approval'; choices: Array<{ id: string; label: string }>; reason?: string }
  | {
      kind: 'userInput'
      questions: Array<{
        id: string
        prompt: string
        options?: Array<{ id: string; label: string; description?: string }>
        isSecret?: boolean
      }>
      blocking: boolean
    }
  | { kind: 'elicitation'; message?: string; form?: JsonValue }
  | { kind: 'toolCall'; name: string; arguments?: JsonValue }
  | { kind: 'other'; summary?: string }

export type AgentLink = {
  id: string
  parentAgentId?: AgentId
  childAgentId?: AgentId
  parentConversationId: ConversationId
  childConversationId?: ConversationId
  childSourceId?: SourceId
  turnId?: TurnId
  activityId?: ActivityId
  task?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

export type ConversationSnapshot = {
  id: ConversationId
  status: ConversationStatus
  title?: string
  tokenUsage?: TokenUsage
  watermark: number
  turns: Record<string, Turn>
  messages: Record<string, Message>
  activities: Record<string, Activity>
  interactions: Record<string, Interaction>
  agentLinks: Record<string, AgentLink>
  diagnostics: AdapterDiagnostic[]
}

export type AdapterDiagnostic = {
  code: string
  sourceId: SourceId
  summary: string
  identity: EventIdentity
}

type ChangeBase = { identity: EventIdentity }

export type ConversationChange =
  | (ChangeBase & {
      type: 'conversation.updated'
      conversationId: ConversationId
      status?: ConversationStatus
      title?: string
      tokenUsage?: TokenUsage
    })
  | (ChangeBase & { type: 'turn.upserted'; turn: Turn })
  | (ChangeBase & {
      type: 'turn.statusChanged'
      turnId: TurnId
      status: TurnStatus
      failure?: { message: string; details?: string }
    })
  | (ChangeBase & { type: 'turn.planUpdated'; turnId: TurnId; plan: TurnPlan })
  | (ChangeBase & { type: 'turn.diffUpdated'; turnId: TurnId; diff: string })
  | (ChangeBase & { type: 'message.upserted'; message: Message })
  | (ChangeBase & {
      type: 'message.partAdded'
      messageId: MessageId
      part: MessagePart
    })
  | (ChangeBase & {
      type: 'message.textDelta'
      messageId: MessageId
      partId: MessagePartId
      delta: string
    })
  | (ChangeBase & {
      type: 'message.statusChanged'
      messageId: MessageId
      status: Message['status']
      completedAt?: string
    })
  | (ChangeBase & { type: 'activity.upserted'; activity: Activity })
  | (ChangeBase & {
      type: 'activity.statusChanged'
      activityId: ActivityId
      status: ActivityStatus
      completedAt?: string
    })
  | (ChangeBase & {
      type: 'activity.outputDelta'
      activityId: ActivityId
      delta: string
    })
  | (ChangeBase & { type: 'interaction.opened'; interaction: Interaction })
  | (ChangeBase & {
      type: 'interaction.resolved'
      interactionId: InteractionId
      outcome: InteractionOutcome
      resolvedAt?: string
    })
  | (ChangeBase & {
      type: 'interaction.cancelled'
      interactionId: InteractionId
      status: 'cancelled' | 'expired'
      resolvedAt?: string
    })
  | (ChangeBase & { type: 'agentLink.upserted'; link: AgentLink })
  | (ChangeBase & { type: 'diagnostic'; diagnostic: AdapterDiagnostic })

export type ConversationCommand =
  | { type: 'turn.start'; conversationId: ConversationId; input: MessagePart[] }
  | { type: 'turn.cancel'; conversationId: ConversationId; turnId: TurnId }
  | {
      type: 'interaction.respond'
      conversationId: ConversationId
      interactionId: InteractionId
      outcome: InteractionOutcome
    }
  | { type: 'conversation.compact'; conversationId: ConversationId }
  | { type: 'conversation.archive'; conversationId: ConversationId }

export type ConversationState = ConversationSnapshot & {
  seenSourceEvents: Set<string>
}

export function createConversationSnapshot(
  id: ConversationId,
  watermark = 0,
): ConversationSnapshot {
  return {
    id,
    status: 'idle',
    watermark,
    turns: {},
    messages: {},
    activities: {},
    interactions: {},
    agentLinks: {},
    diagnostics: [],
  }
}

export function createConversationState(snapshot: ConversationSnapshot): ConversationState {
  return { ...snapshot, seenSourceEvents: new Set() }
}

const terminalTurnStatuses = new Set<TurnStatus>(['completed', 'failed', 'cancelled'])
const terminalActivityStatuses = new Set<ActivityStatus>(['completed', 'failed', 'cancelled'])
const terminalMessageStatuses = new Set<Message['status']>(['completed', 'interrupted', 'failed'])

function emptyTurn(turnId: TurnId): Turn {
  return {
    id: turnId,
    status: 'queued',
    messageIds: [],
    activityIds: [],
    itemOrder: [],
  }
}

function registerTurnItem(state: ConversationState, turnId: TurnId, item: TurnItemRef) {
  const turn = state.turns[turnId] ?? emptyTurn(turnId)
  const order = turn.itemOrder
  state.turns[turnId] = {
    ...turn,
    ...(item.type === 'message'
      ? { messageIds: [...new Set([...turn.messageIds, item.id])] }
      : { activityIds: [...new Set([...turn.activityIds, item.id])] }),
    ...(order && !order.some((entry) => entry.type === item.type && entry.id === item.id)
      ? { itemOrder: [...order, item] }
      : {}),
  }
}

export function applyChange(
  state: ConversationState,
  change: ConversationChange,
): ConversationState {
  const identity = JSON.stringify([change.identity.sourceId, change.identity.sourceEventId])
  if (state.seenSourceEvents.has(identity)) return state

  const next: ConversationState = {
    ...state,
    turns: { ...state.turns },
    messages: { ...state.messages },
    activities: { ...state.activities },
    interactions: { ...state.interactions },
    agentLinks: { ...state.agentLinks },
    diagnostics: [...state.diagnostics],
    seenSourceEvents: new Set(state.seenSourceEvents).add(identity),
    watermark: Math.max(state.watermark, change.identity.applicationSequence ?? state.watermark),
  }

  switch (change.type) {
    case 'conversation.updated':
      if (change.status) next.status = change.status
      if (change.title !== undefined) next.title = change.title
      if (change.tokenUsage !== undefined) next.tokenUsage = change.tokenUsage
      break
    case 'turn.planUpdated':
      next.turns[change.turnId] = {
        ...(next.turns[change.turnId] ?? emptyTurn(change.turnId)),
        plan: change.plan,
      }
      break
    case 'turn.diffUpdated':
      next.turns[change.turnId] = {
        ...(next.turns[change.turnId] ?? emptyTurn(change.turnId)),
        diff: change.diff,
      }
      break
    case 'turn.upserted': {
      const current = next.turns[change.turn.id]
      if (
        current &&
        terminalTurnStatuses.has(current.status) &&
        !terminalTurnStatuses.has(change.turn.status)
      )
        break
      next.turns[change.turn.id] = {
        ...current,
        ...change.turn,
        messageIds: [...new Set([...(current?.messageIds ?? []), ...change.turn.messageIds])],
        activityIds: [...new Set([...(current?.activityIds ?? []), ...change.turn.activityIds])],
        ...(current?.itemOrder
          ? {
              itemOrder: Array.from(
                new Map(
                  [...current.itemOrder, ...(change.turn.itemOrder ?? [])].map((entry) => [
                    `${entry.type}:${entry.id}`,
                    entry,
                  ]),
                ).values(),
              ),
            }
          : {}),
      }
      break
    }
    case 'turn.statusChanged': {
      const current = next.turns[change.turnId]
      if (
        !current ||
        (terminalTurnStatuses.has(current.status) && !terminalTurnStatuses.has(change.status))
      )
        break
      next.turns[change.turnId] = {
        ...current,
        status: change.status,
        ...(change.failure === undefined ? {} : { failure: change.failure }),
      }
      break
    }
    case 'message.upserted': {
      const current = next.messages[change.message.id]
      if (
        current &&
        terminalMessageStatuses.has(current.status) &&
        !terminalMessageStatuses.has(change.message.status)
      )
        break
      const parts = [...change.message.parts]
      if (current) {
        for (const part of current.parts) {
          const index = parts.findIndex((candidate) => candidate.id === part.id)
          if (index < 0) parts.push(part)
          else if (
            part.type === 'text' &&
            parts[index]?.type === 'text' &&
            parts[index].text === ''
          )
            parts[index] = part
        }
      }
      next.messages[change.message.id] = { ...current, ...change.message, parts }
      registerTurnItem(next, change.message.turnId, { type: 'message', id: change.message.id })
      break
    }
    case 'message.partAdded': {
      const current = next.messages[change.messageId]
      if (current && !current.parts.some((part) => part.id === change.part.id))
        next.messages[change.messageId] = { ...current, parts: [...current.parts, change.part] }
      break
    }
    case 'message.textDelta': {
      const current = next.messages[change.messageId]
      const partIndex =
        current?.parts.findIndex((candidate) => candidate.id === change.partId) ?? -1
      const part = current?.parts[partIndex]
      if (current && part?.type === 'text' && !terminalMessageStatuses.has(current.status)) {
        const parts = current.parts.slice()
        parts[partIndex] = { ...part, text: part.text + change.delta }
        next.messages[change.messageId] = {
          ...current,
          parts,
        }
      }
      break
    }
    case 'message.statusChanged': {
      const current = next.messages[change.messageId]
      if (
        !current ||
        (terminalMessageStatuses.has(current.status) && !terminalMessageStatuses.has(change.status))
      )
        break
      next.messages[change.messageId] = {
        ...current,
        status: change.status,
        ...(change.completedAt ? { completedAt: change.completedAt } : {}),
      }
      break
    }
    case 'activity.upserted': {
      const current = next.activities[change.activity.id]
      if (
        current &&
        terminalActivityStatuses.has(current.status) &&
        !terminalActivityStatuses.has(change.activity.status)
      )
        break
      next.activities[change.activity.id] = {
        ...current,
        ...change.activity,
        ...(current?.output && !change.activity.output ? { output: current.output } : {}),
      }
      registerTurnItem(next, change.activity.turnId, { type: 'activity', id: change.activity.id })
      break
    }
    case 'activity.statusChanged': {
      const current = next.activities[change.activityId]
      if (
        !current ||
        (terminalActivityStatuses.has(current.status) &&
          !terminalActivityStatuses.has(change.status))
      )
        break
      next.activities[change.activityId] = {
        ...current,
        status: change.status,
        ...(change.completedAt ? { completedAt: change.completedAt } : {}),
      }
      break
    }
    case 'activity.outputDelta': {
      const current = next.activities[change.activityId]
      if (current && !terminalActivityStatuses.has(current.status))
        next.activities[change.activityId] = {
          ...current,
          output: (current.output ?? '') + change.delta,
        }
      break
    }
    case 'interaction.opened':
      if (!(change.interaction.id in next.interactions))
        next.interactions[change.interaction.id] = { ...change.interaction }
      break
    case 'interaction.resolved': {
      const current = next.interactions[change.interactionId]
      if (current?.status === 'pending')
        next.interactions[change.interactionId] = {
          ...current,
          status: 'resolved',
          outcome: change.outcome,
          ...(change.resolvedAt ? { resolvedAt: change.resolvedAt } : {}),
        }
      break
    }
    case 'interaction.cancelled': {
      const current = next.interactions[change.interactionId]
      if (current?.status === 'pending')
        next.interactions[change.interactionId] = {
          ...current,
          status: change.status,
          ...(change.resolvedAt ? { resolvedAt: change.resolvedAt } : {}),
        }
      break
    }
    case 'agentLink.upserted':
      next.agentLinks[change.link.id] = { ...change.link }
      break
    case 'diagnostic':
      next.diagnostics.push(change.diagnostic)
      break
    default: {
      const exhaustive: never = change
      return exhaustive
    }
  }
  return next
}
