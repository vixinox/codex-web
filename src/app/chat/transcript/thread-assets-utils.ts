import type { ChatBlock, ChatTurnPresentation, ChatUserInputRequest } from '../model/types'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const REASONING_SUMMARY_TITLE = 'Reasoning summary'

export function visibleTurnContent(
  turn: ChatTurnPresentation,
  pendingQuestionnaire: ChatUserInputRequest | undefined,
  finalPlan: ChatTurnPresentation['plan'] | undefined,
) {
  const visibleBlocks = turn.blocks.filter(
    (block) =>
      (block.type === 'assistant' && Boolean(block.text)) ||
      block.type === 'article' ||
      (block.type === 'activity' &&
        block.activities.some((activity) => activity.title !== REASONING_SUMMARY_TITLE)),
  )
  const hasQuestionnaire = Boolean(pendingQuestionnaire || turn.questionnaire)
  const hasFinalPlan = Boolean(finalPlan)
  const hasContent = Boolean(visibleBlocks.length || hasQuestionnaire || hasFinalPlan)
  const trailingBlock = visibleBlocks.at(-1)
  const trailingAssistantId =
    !hasQuestionnaire && !hasFinalPlan && trailingBlock?.type === 'assistant'
      ? trailingBlock.id
      : undefined
  return {
    hasContent,
    trailingAssistantId,
    revision: JSON.stringify({
      blocks: visibleBlocks,
      questionnaire: hasQuestionnaire,
      finalPlan: hasFinalPlan ? finalPlan : undefined,
    }),
  }
}

export function withoutReasoningSummaryActivity(block: ChatBlock): ChatBlock | null {
  if (block.type !== 'activity') return block
  const activities = block.activities.filter(
    (activity) => activity.title !== REASONING_SUMMARY_TITLE,
  )
  return activities.length ? { ...block, activities } : null
}

export function formatTurnTimestamp(timestampMs: number | undefined) {
  if (timestampMs === undefined || !Number.isFinite(timestampMs) || timestampMs <= 0)
    return undefined

  const timestamp = new Date(timestampMs)
  if (Number.isNaN(timestamp.getTime())) return undefined

  const hours = String(timestamp.getHours()).padStart(2, '0')
  const minutes = String(timestamp.getMinutes()).padStart(2, '0')
  if (Date.now() - timestampMs <= DAY_IN_MS) return `${hours}:${minutes}`

  const month = String(timestamp.getMonth() + 1).padStart(2, '0')
  const day = String(timestamp.getDate()).padStart(2, '0')
  return `${month}/${day} ${hours}:${minutes}`
}

export function formatUserContentForCopy(content: Extract<ChatBlock, { type: 'user' }>['content']) {
  return content
    .map((item) =>
      item.type === 'text'
        ? item.text
        : item.type === 'attachment'
          ? `${item.kind === 'image' ? 'Image' : 'Audio'}: ${item.label}`
          : `${item.kind === 'skill' ? 'Skill' : 'Mention'}: ${item.label}`,
    )
    .join('\n')
}
