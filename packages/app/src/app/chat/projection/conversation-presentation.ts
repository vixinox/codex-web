import type {
  Activity,
  ConversationSnapshot,
  Interaction,
  Message,
  TokenUsageBreakdown,
} from '@codex-web/conversation'
import { createAttachment, shouldUseCard } from '@/app/chat/composer/model/draft-model'
import { parseMarkdownBlocks } from '@/app/chat/composer/logic/chat-input-markdown'
import type {
  ChatActivity,
  ChatBlock,
  ChatThreadPresentation,
  ChatTurnPresentation,
  ChatUserContent,
} from '@/app/chat/model/types'
import { derivePlanPhase } from './plan-lifecycle'
import { countDiffStats } from '@/app/chat/native/diff-stats'

const activityDisplay = {
  commandExecution: ['command', 'Ran command'],
  fileChange: ['file', 'Changed files'],
  webSearch: ['search', 'Searched the web'],
  mcpToolCall: ['tool', 'Called tool'],
  dynamicToolCall: ['tool', 'Called tool'],
  collabAgentToolCall: ['agent', 'Used agents'],
  subAgentActivity: ['agent', 'Agent activity'],
  reasoning: ['reasoning', 'Reasoning summary'],
  imageView: ['image', 'Viewed image'],
  imageGeneration: ['image', 'Generated image'],
  sleep: ['system', 'Waited'],
  enteredReviewMode: ['system', 'Entered review mode'],
  exitedReviewMode: ['system', 'Exited review mode'],
} as const satisfies Partial<Record<Activity['kind'], readonly [ChatActivity['kind'], string]>>

export function projectConversation(
  state: ConversationSnapshot,
  projectId: string | null,
): ChatThreadPresentation {
  const interactions = new Map<string, Interaction[]>()
  for (const interaction of Object.values(state.interactions)) {
    const entries = interactions.get(interaction.turnId) ?? []
    entries.push(interaction)
    interactions.set(interaction.turnId, entries)
  }
  const pending = Object.values(state.interactions).find(
    (entry) => entry.status === 'pending' && entry.details?.kind === 'userInput',
  )
  const userInput = pending && projectUserInput(pending)
  const turns = Object.values(state.turns).map((turn): ChatTurnPresentation => {
    const messages = Object.values(state.messages).filter((message) => message.turnId === turn.id)
    const activities = Object.values(state.activities).filter(
      (activity) => activity.turnId === turn.id,
    )
    const byMessageId = new Map(messages.map((message) => [message.id, message]))
    const byActivityId = new Map(activities.map((activity) => [activity.id, activity]))
    const orderedMessages = [...new Set([...turn.messageIds, ...byMessageId.keys()])].flatMap(
      (id) => byMessageId.get(id) ?? [],
    )
    const orderedActivities = [...new Set([...turn.activityIds, ...byActivityId.keys()])].flatMap(
      (id) => byActivityId.get(id) ?? [],
    )
    const blocks: ChatBlock[] = []
    const status =
      turn.status === 'queued' || turn.status === 'inProgress'
        ? 'inProgress'
        : turn.status === 'cancelled'
          ? 'interrupted'
          : turn.status
    const fallbackOrder = [
      ...orderedMessages
        .filter(({ role }) => role === 'user')
        .map(({ id }) => ({ type: 'message', id }) as const),
      ...orderedActivities.map(({ id }) => ({ type: 'activity', id }) as const),
      ...orderedMessages
        .filter(({ role }) => role === 'assistant')
        .map(({ id }) => ({ type: 'message', id }) as const),
    ]
    const order = new Map(
      [...(turn.itemOrder ?? []), ...fallbackOrder].map((item) => [
        `${item.type}:${item.id}`,
        item,
      ]),
    )
    const final = [...order.values()].findLast((item) => {
      if (item.type !== 'message') return false
      const message = byMessageId.get(item.id)
      return message?.role === 'assistant' && message.phase === 'final_answer'
    })
    let planText: string | undefined
    for (const item of order.values()) {
      if (item.type === 'activity') {
        const activity = byActivityId.get(item.id)
        if (activity?.kind === 'plan') planText = activity.output ?? planText
        else if (activity) appendActivity(blocks, activity, state)
        continue
      }
      const message = byMessageId.get(item.id)
      if (message?.role === 'user') {
        blocks.push({ id: message.id, type: 'user', content: projectUserContent(message) })
        continue
      }
      if (message?.role !== 'assistant') continue
      blocks.push({
        id: message.id,
        type: 'assistant',
        text: message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
        ...(item === final ? { final: true } : {}),
      })
    }
    if (turn.diff) attachDiff(blocks, turn.id, turn.diff)
    const plan =
      turn.plan?.steps.length || planText
        ? {
            steps: turn.plan?.steps ?? [],
            diffStats: countDiffStats(
              turn.diff,
              blocks.flatMap((block) =>
                block.type === 'activity'
                  ? block.activities.flatMap((activity) => activity.changes ?? [])
                  : [],
              ),
            ),
            ...(planText ? { text: planText } : {}),
            ...(turn.plan?.explanation === undefined ? {} : { explanation: turn.plan.explanation }),
            final: status === 'completed' && planText !== undefined,
          }
        : undefined
    const resolved = interactions
      .get(turn.id)
      ?.findLast((entry) => entry.status !== 'pending' && entry.details?.kind === 'userInput')
    const questionnaire = resolved && projectQuestionnaire(resolved)
    const startedAt = timestamp(turn.startedAt)
    const completedAt = timestamp(turn.completedAt)
    return {
      id: turn.id,
      status,
      blocks,
      ...(questionnaire ? { questionnaire } : {}),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(completedAt === undefined ? {} : { completedAt }),
      ...(turn.durationMs === undefined ? {} : { durationMs: turn.durationMs }),
      ...(status === 'failed' ? { error: { message: 'The turn failed.' } } : {}),
      ...(plan ? { plan } : {}),
      planPhase: derivePlanPhase({
        status,
        plan,
        userInput: userInput?.turnId === turn.id ? userInput : undefined,
      }),
    }
  })
  return {
    id: state.id,
    title: state.title ?? 'Untitled thread',
    projectId,
    turns,
    isBusy: turns.some((turn) => turn.status === 'inProgress'),
    ...(state.tokenUsage
      ? {
          tokenUsage: {
            modelContextWindow: state.tokenUsage.modelContextWindow,
            last: projectUsageBreakdown(state.tokenUsage.last),
            total: projectUsageBreakdown(state.tokenUsage.total),
          },
        }
      : {}),
    ...(userInput ? { userInput } : {}),
  }
}

function projectUsageBreakdown({
  inputTokens,
  outputTokens,
  reasoningOutputTokens,
  totalTokens,
}: TokenUsageBreakdown) {
  return { inputTokens, outputTokens, reasoningOutputTokens, totalTokens }
}

function projectUserContent(message: Message): ChatUserContent[] {
  return message.parts.flatMap((part): ChatUserContent[] => {
    if (part.type === 'image' || part.type === 'audio')
      return [
        { type: 'attachment', kind: part.type, label: part.type === 'image' ? 'Image' : 'Audio' },
      ]
    if (part.type !== 'text') return []
    return parseMarkdownBlocks(part.text).flatMap((block): ChatUserContent[] => {
      if (block.kind === 'code' && shouldUseCard(block.text)) {
        const { text, title, lineCount, characterCount } = createAttachment(block.text)
        return [{ type: 'codeSnippet', text, title, lineCount, characterCount }]
      }
      if (block.kind === 'code') return [{ type: 'text', text: `\`\`\`\n${block.text}\n\`\`\`` }]
      return block.kind === 'text' && block.text ? [{ type: 'text', text: block.text }] : []
    })
  })
}

function appendActivity(blocks: ChatBlock[], activity: Activity, state: ConversationSnapshot) {
  const status =
    activity.status === 'inProgress' || activity.status === 'pending' ? 'running' : activity.status
  if (activity.kind === 'contextCompaction') {
    const titles = {
      running: 'Context compacting',
      completed: 'Context compacted',
      cancelled: 'Context compaction cancelled',
      failed: 'Context compaction failed',
    }
    blocks.push({
      id: activity.id,
      type: 'article',
      kind: 'context-compaction',
      status,
      title: titles[status],
    })
    return
  }
  if (!Object.hasOwn(activityDisplay, activity.kind)) return
  const [kind, defaultTitle] = activityDisplay[activity.kind as keyof typeof activityDisplay]
  const agentCount =
    kind === 'agent'
      ? Object.values(state.agentLinks).filter((link) => link.activityId === activity.id).length
      : 0
  const projected: ChatActivity = {
    id: activity.id,
    sourceType: activity.kind,
    kind,
    title:
      activity.command ??
      (kind === 'search' || kind === 'tool' ? activity.title : undefined) ??
      defaultTitle,
    status,
    ...(activity.output === undefined ? {} : { output: activity.output }),
    ...(activity.command === undefined ? {} : { command: activity.command }),
    ...(activity.commandStatus && activity.commandStatus !== 'inProgress'
      ? { commandStatus: activity.commandStatus }
      : {}),
    ...(activity.exitCode === undefined ? {} : { exitCode: activity.exitCode }),
    ...(activity.durationMs === undefined ? {} : { durationMs: activity.durationMs }),
    ...(activity.changes?.length ? { changes: activity.changes } : {}),
    ...(activity.truncated ? { truncated: true } : {}),
    ...(agentCount ? { meta: `${agentCount} agents` } : {}),
  }
  pushActivity(blocks, projected)
}

function pushActivity(blocks: ChatBlock[], activity: ChatActivity) {
  const { kind } = activity
  const previous = blocks.at(-1)
  if (previous?.type === 'activity' && previous.kind === kind) previous.activities.push(activity)
  else
    blocks.push({ id: `activity-${activity.id}`, type: 'activity', kind, activities: [activity] })
}

function attachDiff(blocks: ChatBlock[], turnId: string, diff: string) {
  const target = blocks.find((block) => block.type === 'activity' && block.kind === 'file')
  if (target?.type === 'activity') {
    if (target.activities.some((activity) => activity.changes?.some((change) => change.diff)))
      return
    const activity = target.activities.at(-1)
    if (activity) activity.aggregatedDiff = diff
  } else {
    pushActivity(blocks, {
      id: `${turnId}-file-changes`,
      sourceType: 'fileChange',
      kind: 'file',
      title: 'Changed files',
      status: 'completed',
      aggregatedDiff: diff,
    })
  }
}

function projectUserInput(entry: Interaction): ChatThreadPresentation['userInput'] {
  if (entry.details?.kind !== 'userInput') return undefined
  return {
    requestId: entry.id,
    itemId: entry.activityId ?? entry.id,
    turnId: entry.turnId,
    isBlocking: entry.details.blocking,
    questions: entry.details.questions.map((question) => ({
      id: question.id,
      header: question.id,
      question: question.prompt,
      ...(question.isSecret === undefined ? {} : { isSecret: question.isSecret }),
      ...(question.options
        ? {
            options: question.options.map(({ label, description }) => ({
              label,
              description: description ?? '',
            })),
          }
        : {}),
    })),
  }
}

function projectQuestionnaire(entry: Interaction): ChatTurnPresentation['questionnaire'] {
  if (entry.details?.kind !== 'userInput') return undefined
  const answers = entry.outcome?.kind === 'answers' ? entry.outcome.answers : undefined
  return {
    requestId: entry.id,
    questionCount: entry.details.questions.length,
    questions: entry.details.questions.map((question) => ({
      id: question.id,
      question: question.prompt,
      answers: [...(answers?.[question.id] ?? [])],
    })),
  }
}

function timestamp(value: string | undefined) {
  const time = value === undefined ? NaN : Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}
