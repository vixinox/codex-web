import type { QueuedMessage } from './composer-store'

export type QueueContext = {
  healthy: boolean
  blocked: boolean
  turns: readonly { id: string; status: string }[]
  nonSteerable: boolean
}

export function queueTransition(
  queue: QueuedMessage,
  context: QueueContext | undefined,
  working: boolean,
): 'wait' | 'pause' | 'send' {
  if (queue.status !== 'queued' || !context?.healthy) return 'wait'
  const status = context.turns.find((turn) => turn.id === queue.turnId)?.status
  if (status === 'failed' || status === 'interrupted') return 'pause'
  return status === 'completed' && !working && !context.blocked ? 'send' : 'wait'
}

/** Claim before any await; both steer and auto-send must use the same item. */
export function claimQueuedMessage(queue: QueuedMessage): boolean {
  if (queue.status !== 'queued') return false
  queue.status = 'sending'
  return true
}
