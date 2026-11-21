import {
  applyChange,
  type ConversationChange,
  type ConversationState,
} from '@codex-web/conversation'

export function applyConversationDelivery(
  state: ConversationState,
  change: ConversationChange,
): ConversationState {
  const sequence = change.identity.applicationSequence
  if (sequence !== undefined && sequence <= state.watermark) return state
  return applyChange(state, change)
}
