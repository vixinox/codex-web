import type { ConversationChange, ConversationSnapshot } from '@codex-web/conversation'
import type { ChatPendingTurn } from '@/app/chat/model/types'
import type { ThreadSession } from '@/app/chat/session/interface'

export type ScenarioStep = { at: number; afterAnswer?: string } & (
  | { kind: 'change'; change: ConversationChange }
  | { kind: 'snapshot'; snapshot: ConversationSnapshot }
  | { kind: 'error'; message: string }
  | { kind: 'pending'; pending: ChatPendingTurn | null }
)
export type Scenario = {
  id: string
  name: string
  description: string
  source: string
  initial: ConversationSnapshot
  steps: ScenarioStep[]
  loading?: boolean
}
export function applyScenarioStep(session: ThreadSession, step: ScenarioStep) {
  if (step.kind === 'change') session.applyConversationChange(step.change)
  if (step.kind === 'snapshot') session.replaceConversation(step.snapshot)
  if (step.kind === 'error') session.setError(step.message)
}
export function nextDelay(steps: readonly ScenarioStep[], index: number) {
  return index >= steps.length ? null : Math.max(0, steps[index].at - (steps[index - 1]?.at ?? 0))
}
