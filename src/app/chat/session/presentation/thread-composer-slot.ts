import type { ComposerViewModel, ThreadComposerSlotModel } from '@/app/chat/model/composer-types'
import type {
  ChatPlanPresentation,
  ChatThreadPresentation,
  ChatUserInputQuestion,
  ChatUserInputRequest,
} from '@/app/chat/model/types'

export function buildThreadComposerSlot(
  composer: ComposerViewModel,
  turns: readonly { status: ChatThreadPresentation['turns'][number]['status']; plan?: unknown }[],
  userInput?: unknown,
): ThreadComposerSlotModel {
  const activePlanValue = turns.find((turn) => turn.status === 'inProgress')?.plan
  const activePlan = isPlanPresentation(activePlanValue) ? activePlanValue : undefined
  const lastPlanValue = turns.at(-1)?.plan
  const lastPlan = isPlanPresentation(lastPlanValue) ? lastPlanValue : undefined
  const finalPlan = lastPlan?.final ? lastPlan : undefined

  if (composer.error) return { kind: 'error', message: composer.error }
  if (isUserInputRequest(userInput)) return { kind: 'questionnaire', request: userInput }
  if (finalPlan) return { kind: 'final-plan', plan: finalPlan }
  return {
    kind: 'input',
    composer,
    ...(activePlan ? { plan: activePlan } : {}),
  }
}

function isPlanPresentation(value: unknown): value is ChatPlanPresentation {
  if (!isRecord(value) || typeof value.final !== 'boolean') return false
  return Array.isArray(value.steps) && isRecord(value.diffStats)
}

function isUserInputRequest(value: unknown): value is ChatUserInputRequest {
  if (
    !isRecord(value) ||
    !['number', 'string'].includes(typeof value.requestId) ||
    typeof value.turnId !== 'string' ||
    typeof value.itemId !== 'string' ||
    typeof value.isBlocking !== 'boolean' ||
    !Array.isArray(value.questions)
  )
    return false
  return value.questions.every(isQuestion)
}

function isQuestion(value: unknown): value is ChatUserInputQuestion {
  return isRecord(value) && typeof value.id === 'string' && typeof value.question === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
