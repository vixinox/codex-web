import type {
  ChatPlanPhase,
  ChatPlanPresentation,
  ChatPresentationStatus,
  ChatUserInputRequest,
} from '@/app/chat/model/types'

export function derivePlanPhase(input: {
  status: ChatPresentationStatus
  plan?: ChatPlanPresentation
  userInput?: ChatUserInputRequest
}): ChatPlanPhase {
  if (input.status === 'failed') return 'failed'
  if (input.status === 'interrupted') return 'interrupted'
  if (input.userInput) return 'questionnaire'
  if (input.plan?.final && input.status === 'completed') return 'plan-ready'
  if (input.status === 'inProgress' && input.plan) return 'executing'
  if (input.status === 'inProgress') return 'planning'
  if (input.status === 'completed' && input.plan) return 'completed'
  return 'default'
}
