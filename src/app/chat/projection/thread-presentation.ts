import type { CodexThreadState } from '@/app/chat/native/codex-thread'
import type { CodexRecord } from '@/lib/protocol/protocol'
import { countDiffStats } from '@/app/chat/native/diff-stats'
import { createAttachment, shouldUseCard } from '@/app/chat/composer/draft-model'
import { parseMarkdownBlocks } from '@/app/chat/composer/chat-input-markdown'
import type {
  ChatActivity,
  ChatActivityKind,
  ChatBlock,
  ChatPlanStep,
  ChatThreadPresentation,
  ChatTurnPresentation,
  ChatUserContent,
} from '@/app/chat/model/types'

export function toChatThreadPresentation(state: CodexThreadState): ChatThreadPresentation {
  const metadata = toChatThreadMetadata(state)
  const thread = state.thread
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  return {
    ...metadata,
    turns: turns.map((turn, index) =>
      toChatTurnPresentation(
        turn,
        index,
        index === 0 ? state.protocolErrors : [],
        state.questionnaireSummaries?.[stringValue(isRecord(turn) ? turn.id : undefined) ?? ''],
      ),
    ),
  }
}

export function toChatThreadMetadata(
  state: CodexThreadState,
): Omit<ChatThreadPresentation, 'turns'> {
  const thread = state.thread
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  const tokenUsage = adaptTokenUsage(thread.tokenUsage)
  const model = chatModel(thread.model)
  const reasoningEffort = chatEffort(thread.reasoningEffort)
  return {
    id: stringValue(thread.id) ?? 'invalid-thread',
    projectId: state.projectId,
    title: stringValue(thread.name) ?? stringValue(thread.preview) ?? 'Untitled thread',
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    modelProvider: stringValue(thread.modelProvider),
    updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt : null,
    isBusy: turns.some((turn) => isRecord(turn) && turn.status === 'inProgress'),
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(state.userInput ? { userInput: adaptUserInput(state.userInput) } : {}),
  }
}

const CHAT_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5'] as const
const CHAT_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const

function chatModel(value: unknown): ChatThreadPresentation['model'] {
  if (typeof value !== 'string') return undefined
  return CHAT_MODELS.find((model) => model === value)
}

function chatEffort(value: unknown): ChatThreadPresentation['reasoningEffort'] {
  if (typeof value !== 'string') return undefined
  return CHAT_EFFORTS.find((effort) => effort === value)
}

function adaptUserInput(value: NonNullable<CodexThreadState['userInput']>) {
  return {
    requestId: value.requestId,
    turnId: value.turnId,
    itemId: value.itemId,
    isBlocking: value.isBlocking,
    questions: value.questions.flatMap((q) => {
      const id = stringValue(q.id)
      const text = stringValue(q.question)
      if (!id || !text) return []
      const options = Array.isArray(q.options)
        ? q.options.flatMap((o) =>
            isRecord(o) && typeof o.label === 'string' && typeof o.description === 'string'
              ? [{ label: o.label, description: o.description }]
              : [],
          )
        : q.options === null
          ? null
          : undefined
      return [
        {
          id,
          header: stringValue(q.header) ?? id,
          question: text,
          ...(options !== undefined ? { options } : {}),
          ...(typeof q.isSecret === 'boolean' ? { isSecret: q.isSecret } : {}),
          ...(typeof q.isOther === 'boolean' ? { isOther: q.isOther } : {}),
        },
      ]
    }),
  }
}
function adaptTokenUsage(value: unknown) {
  if (!isRecord(value)) return undefined
  const last = adaptBreakdown(value.last)
  const total = adaptBreakdown(value.total)
  if (!last || !total) return undefined
  return {
    modelContextWindow:
      typeof value.modelContextWindow === 'number' ? value.modelContextWindow : null,
    last,
    total,
  }
}
function adaptBreakdown(value: unknown) {
  if (!isRecord(value)) return undefined
  const { inputTokens, outputTokens, reasoningOutputTokens, totalTokens } = value
  if (
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    typeof reasoningOutputTokens !== 'number' ||
    typeof totalTokens !== 'number'
  )
    return undefined
  return { inputTokens, outputTokens, reasoningOutputTokens, totalTokens }
}
export function toChatTurnPresentation(
  value: unknown,
  index: number,
  errors: readonly string[],
  questionnaire?: ChatTurnPresentation['questionnaire'],
): ChatTurnPresentation {
  const turn = isRecord(value) ? value : {}
  const id = stringValue(turn.id) ?? `turn-${index}`
  const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : []
  const blocks: ChatBlock[] = []
  const finalId = [...items]
    .reverse()
    .find((item) => item.type === 'agentMessage' && item.phase === 'final_answer')?.id
  for (const item of items) {
    const itemId = stringValue(item.id) ?? `${id}-item`
    const type = stringValue(item.type)
    if (type === 'userMessage') {
      blocks.push({ id: itemId, type: 'user', content: adaptUserContent(item.content) })
      continue
    }
    if (type === 'agentMessage') {
      const text = stringValue(item.text)
      if (text !== undefined)
        blocks.push({
          id: itemId,
          type: 'assistant',
          text,
          ...(finalId === itemId ? { final: true } : {}),
        })
      continue
    }
    if (type === 'contextCompaction') {
      const compactionStatus = stringValue(item.status)
      const status =
        compactionStatus === 'inProgress'
          ? 'running'
          : compactionStatus === 'completed'
            ? 'completed'
            : compactionStatus === 'interrupted' || compactionStatus === 'cancelled'
              ? 'cancelled'
              : 'failed'
      blocks.push({
        id: itemId,
        type: 'article',
        kind: 'context-compaction',
        title:
          status === 'running'
            ? 'Context compacting'
            : status === 'completed'
              ? 'Context compacted'
              : status === 'cancelled'
                ? 'Context compaction cancelled'
                : 'Context compaction failed',
        status,
      })
      continue
    }
    if (type === 'plan') continue
    const activity = adaptActivity(item)
    if (activity) pushActivity(blocks, activity)
  }
  if (typeof turn.diff === 'string' && turn.diff) attachDiff(blocks, id, turn.diff)
  if (errors.length)
    blocks.push({ id: `${id}-protocol-error`, type: 'error', message: errors.at(-1)! })
  const plan = Array.isArray(turn.plan)
    ? turn.plan.flatMap((step): ChatPlanStep[] =>
        isRecord(step) && typeof step.step === 'string' && isPlanStepStatus(step.status)
          ? [{ step: step.step, status: step.status }]
          : [],
      )
    : []
  const finalPlan = [...items]
    .reverse()
    .find((item) => item.type === 'plan' && typeof item.text === 'string')
  const finalPlanText = typeof finalPlan?.text === 'string' ? finalPlan.text : undefined
  const status =
    turn.status === 'failed' || turn.status === 'interrupted'
      ? turn.status
      : turn.status === 'inProgress'
        ? 'inProgress'
        : 'completed'
  const turnError = isRecord(turn.error) ? turn.error : undefined
  const info =
    turnError && isRecord(turnError.codexErrorInfo) ? turnError.codexErrorInfo : undefined
  const details = [
    stringValue(turnError?.additionalDetails),
    typeof info?.httpStatusCode === 'number' ? `HTTP ${info.httpStatusCode}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const error = turnError
    ? {
        message: stringValue(turnError.message) ?? 'The turn failed.',
        ...(details ? { details } : {}),
      }
    : undefined
  const fileChanges = blocks.flatMap((block) =>
    block.type === 'activity' ? block.activities.flatMap((activity) => activity.changes ?? []) : [],
  )
  return {
    id,
    status,
    blocks,
    ...(questionnaire ? { questionnaire } : {}),
    ...(typeof turn.startedAt === 'number'
      ? { startedAt: codexTimestampSecondsToMs(turn.startedAt) }
      : {}),
    ...(typeof turn.completedAt === 'number'
      ? { completedAt: codexTimestampSecondsToMs(turn.completedAt) }
      : {}),
    ...(typeof turn.durationMs === 'number' ? { durationMs: turn.durationMs } : {}),
    ...(error ? { error } : {}),
    ...(plan.length || finalPlanText
      ? {
          plan: {
            steps: plan,
            diffStats: countDiffStats(
              typeof turn.diff === 'string' ? turn.diff : undefined,
              fileChanges,
            ),
            ...(finalPlanText ? { text: finalPlanText } : {}),
            ...(typeof turn.planExplanation === 'string'
              ? { explanation: turn.planExplanation }
              : {}),
            final: status === 'completed' && Boolean(finalPlan),
          },
        }
      : {}),
  }
}

export function codexTimestampSecondsToMs(value: number) {
  return value * 1000
}
function adaptActivity(item: CodexRecord) {
  const id = stringValue(item.id)
  const sourceType = stringValue(item.type)
  if (!id || !sourceType) return null
  const searchAction = sourceType === 'webSearch' ? adaptSearchAction(item.action) : undefined
  const map: Record<string, { kind: ChatActivityKind; title: string }> = {
    commandExecution: { kind: 'command', title: 'Ran command' },
    fileChange: { kind: 'file', title: 'Changed files' },
    webSearch: {
      kind: 'search',
      title:
        searchAction?.type === 'openPage'
          ? 'Opened page'
          : searchAction?.type === 'findInPage'
            ? 'Found in page'
            : (stringValue(item.query) ?? 'Searched the web'),
    },
    mcpToolCall: { kind: 'tool', title: stringValue(item.tool) ?? 'Called tool' },
    dynamicToolCall: { kind: 'tool', title: stringValue(item.tool) ?? 'Called tool' },
    collabToolCall: { kind: 'agent', title: 'Used agents' },
    collabAgentToolCall: { kind: 'agent', title: 'Used agents' },
    subAgentActivity: { kind: 'agent', title: 'Agent activity' },
    reasoning: { kind: 'reasoning', title: 'Reasoning summary' },
    imageView: { kind: 'image', title: 'Viewed image' },
    imageGeneration: { kind: 'image', title: 'Generated image' },
    sleep: { kind: 'system', title: 'Waited' },
    enteredReviewMode: { kind: 'system', title: 'Entered review mode' },
    exitedReviewMode: { kind: 'system', title: 'Exited review mode' },
    contextCompaction: { kind: 'system', title: 'Context compacted' },
    guestTurnLimit: { kind: 'system', title: 'Guest turn token limit reached' },
  }
  const mapped = map[sourceType] ?? { kind: 'system', title: sourceType }
  const status: 'running' | 'failed' | 'cancelled' | 'completed' =
    item.status === 'inProgress'
      ? 'running'
      : item.status === 'failed' || item.status === 'declined'
        ? 'failed'
        : item.status === 'interrupted'
          ? 'cancelled'
          : 'completed'
  const changes = Array.isArray(item.changes)
    ? item.changes.flatMap((c) =>
        isRecord(c) &&
        typeof c.path === 'string' &&
        isRecord(c.kind) &&
        typeof c.kind.type === 'string'
          ? [
              {
                path: c.path,
                kind: c.kind.type,
                ...(typeof c.kind.move_path === 'string' ? { movePath: c.kind.move_path } : {}),
                ...(typeof c.diff === 'string' ? { diff: c.diff } : {}),
              },
            ]
          : [],
      )
    : undefined
  const commandStatus: 'completed' | 'failed' | 'declined' | 'interrupted' | undefined =
    sourceType === 'commandExecution' &&
    (item.status === 'completed' ||
      item.status === 'failed' ||
      item.status === 'declined' ||
      item.status === 'interrupted')
      ? item.status
      : undefined
  return {
    id,
    sourceType,
    kind: mapped.kind,
    title: mapped.title,
    status,
    ...(typeof item.command === 'string' ? { command: item.command } : {}),
    ...(commandStatus ? { commandStatus } : {}),
    ...(typeof item.exitCode === 'number' && Number.isFinite(item.exitCode)
      ? { exitCode: item.exitCode }
      : {}),
    ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
    ...(typeof item.aggregatedOutput === 'string' ? { output: item.aggregatedOutput } : {}),
    ...(activityDetail(item) ? { detail: activityDetail(item) } : {}),
    ...(activityMeta(item) ? { meta: activityMeta(item) } : {}),
    ...(searchAction ? { searchAction } : {}),
    ...(item.truncated === true ? { truncated: true } : {}),
    ...(changes?.length ? { changes } : {}),
  }
}

function adaptSearchAction(value: unknown) {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (value.type === 'search') {
    const queries = Array.isArray(value.queries)
      ? value.queries.filter((entry): entry is string => typeof entry === 'string')
      : undefined
    return {
      type: 'search' as const,
      ...(typeof value.query === 'string' ? { query: value.query } : {}),
      ...(queries?.length ? { queries } : {}),
    }
  }
  if (value.type === 'openPage')
    return {
      type: 'openPage' as const,
      ...(typeof value.url === 'string' ? { url: value.url } : {}),
    }
  if (value.type === 'findInPage')
    return {
      type: 'findInPage' as const,
      ...(typeof value.url === 'string' ? { url: value.url } : {}),
      ...(typeof value.pattern === 'string' ? { pattern: value.pattern } : {}),
    }
  return null
}
function adaptUserContent(value: unknown): ChatUserContent[] {
  if (!Array.isArray(value)) return []
  const skillNames = value.flatMap((part) =>
    isRecord(part) && part.type === 'skill' && typeof part.name === 'string' ? [part.name] : [],
  )
  return value.flatMap((part): ChatUserContent[] => {
    if (!isRecord(part)) return []
    if (part.type === 'skill' && typeof part.name === 'string')
      return [{ type: 'reference' as const, kind: 'skill' as const, label: part.name }]
    if (part.type === 'mention' && typeof part.name === 'string')
      return [{ type: 'reference' as const, kind: 'mention' as const, label: part.name }]
    if (part.type === 'image' || part.type === 'audio')
      return [
        {
          type: 'attachment' as const,
          kind: part.type,
          label: part.type === 'image' ? 'Image' : 'Audio',
        },
      ]
    if (part.type !== 'text' || typeof part.text !== 'string') return []
    const text = stripInjectedSkillMarkers(part.text, skillNames)
    return parseMarkdownBlocks(text).flatMap((block): ChatUserContent[] => {
      if (block.kind === 'code' && shouldUseCard(block.text)) {
        const attachment = createAttachment(block.text)
        return [
          {
            type: 'codeSnippet' as const,
            text: attachment.text,
            title: attachment.title,
            lineCount: attachment.lineCount,
            characterCount: attachment.characterCount,
          },
        ]
      }
      if (block.kind === 'code')
        return [{ type: 'text' as const, text: `\`\`\`\n${block.text}\n\`\`\`` }]
      if (block.kind === 'text' && block.text) return [{ type: 'text' as const, text: block.text }]
      return []
    })
  })
}

function activityDetail(item: CodexRecord) {
  const values = [
    typeof item.progress === 'string' ? item.progress : undefined,
    typeof item.result === 'string' ? item.result : undefined,
    Array.isArray(item.summary)
      ? item.summary.filter((entry): entry is string => typeof entry === 'string').join('\n')
      : undefined,
    typeof item.revisedPrompt === 'string' ? item.revisedPrompt : undefined,
    typeof item.detail === 'string' ? item.detail : undefined,
    isRecord(item.error) && typeof item.error.message === 'string' ? item.error.message : undefined,
  ].filter((entry): entry is string => Boolean(entry))
  return values.length ? values.join('\n') : undefined
}

function activityMeta(item: CodexRecord) {
  const action =
    isRecord(item.action) && typeof item.action.type === 'string' ? item.action.type : undefined
  const values = [
    typeof item.server === 'string' ? item.server : undefined,
    typeof item.namespace === 'string' ? item.namespace : undefined,
    typeof item.kind === 'string' ? item.kind : undefined,
    typeof item.review === 'string' ? item.review : undefined,
    action,
    typeof item.agentCount === 'number' ? `${item.agentCount} agents` : undefined,
  ].filter((entry): entry is string => Boolean(entry))
  return values.length ? values.join(' · ') : undefined
}

function stripInjectedSkillMarkers(text: string, skillNames: readonly string[]) {
  if (skillNames.length === 0) return text
  const prefix = `${skillNames.map((name) => `$${name}`).join(' ')}\n`
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}
function pushActivity(blocks: ChatBlock[], activity: ChatActivity) {
  const previous = blocks.at(-1)
  if (previous?.type === 'activity' && previous.kind === activity.kind)
    previous.activities.push(activity)
  else
    blocks.push({
      id: `activity-${activity.id}`,
      type: 'activity',
      kind: activity.kind,
      activities: [activity],
    })
}
function attachDiff(blocks: ChatBlock[], turnId: string, diff: string) {
  const target = blocks.find(
    (block): block is Extract<ChatBlock, { type: 'activity' }> =>
      block.type === 'activity' && block.kind === 'file',
  )
  if (
    target &&
    target.activities.some((activity) => activity.changes?.some((change) => Boolean(change.diff)))
  )
    return
  if (target) target.activities.at(-1)!.aggregatedDiff = diff
  else
    pushActivity(blocks, {
      id: `${turnId}-file-changes`,
      sourceType: 'fileChange',
      kind: 'file',
      title: 'Changed files',
      status: 'completed',
      aggregatedDiff: diff,
    })
}
function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}
function isPlanStepStatus(value: unknown): value is ChatPlanStep['status'] {
  return value === 'pending' || value === 'inProgress' || value === 'completed'
}
function isRecord(value: unknown): value is CodexRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
