import type { ChatTurnPresentation } from '@/app/chat/model/types'
import { formatDuration } from '@/app/chat/transcript/formatting'

export function getTurnWorkLabel(
  turn: ChatTurnPresentation,
  nowMs: number,
  localCompacting = false,
): string | null {
  if (turn.status === 'inProgress') {
    if (
      localCompacting ||
      turn.blocks.some((block) => block.type === 'article' && block.status === 'running')
    )
      return 'Compacting'
    const startedAt = turn.startedAt ?? nowMs
    return `Working for ${formatDuration(Math.max(0, nowMs - startedAt))}`
  }
  if (turn.status === 'interrupted')
    return `You stopped after ${formatDuration(turn.durationMs ?? 0)}`
  if (turn.status === 'completed' || turn.status === 'failed')
    return `Worked for ${formatDuration(turn.durationMs ?? 0)}`
  return null
}
