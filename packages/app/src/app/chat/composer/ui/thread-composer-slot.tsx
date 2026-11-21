import { ComposerContainer } from '@/app/chat/composer/ui/composer-container'
import * as React from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ComposerInput } from '@/app/chat/composer/ui/composer-input'
import { EMPTY_OWNER_COMPOSER_CAPABILITIES } from '@/app/chat/composer/model/composer-capabilities'
import type { ComposerCapabilities } from '@/app/chat/composer/model/composer-capabilities'
import { PlanPanel } from '@/app/chat/composer/ui/plan-panel'
import {
  Questionnaire,
  type QuestionnaireAnswer,
} from '@/app/chat/questionnaire/user-input-questionnaire'
import type { ComposerActions, ThreadComposerSlotModel } from '@/app/chat/model/composer-types'

export function ThreadComposerSlot({
  slot,
  actions,
  capabilities = EMPTY_OWNER_COMPOSER_CAPABILITIES,
}: {
  slot: ThreadComposerSlotModel
  actions: ComposerActions & {
    retry: () => void
    answerUserInput: (answers: Record<string, { answers: string[] }>) => Promise<void>
    cancelUserInput: () => Promise<void>
  }
  capabilities?: ComposerCapabilities
}) {
  const [dismissedPlan, setDismissedPlan] = React.useState<string | null>(null)
  const planKey = slot.kind === 'final-plan' ? JSON.stringify(slot.plan) : null
  const visibleFinalPlan = slot.kind === 'final-plan' && planKey !== dismissedPlan
  return (
    <ComposerContainer>
      {'composer' in slot && slot.composer?.error ? <Alert variant="destructive"><AlertDescription>{slot.composer.error}</AlertDescription></Alert> : null}
      {slot.kind === 'questionnaire' && (slot.pendingCount ?? 0) > 1 ? <p className="px-2 text-xs">{slot.pendingCount} requests waiting</p> : null}
      {slot.kind === 'error' ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{slot.message}</AlertDescription>
        </Alert>
      ) : null}
      {slot.kind === 'input' && slot.plan ? <PlanPanel plan={slot.plan} /> : null}
      {slot.kind === 'questionnaire' ? (
        <div><Questionnaire
          key={`${String(slot.request.requestId)}:${slot.request.questions.map((question) => question.id).join('|')}`}
          questions={slot.request.questions}
          inputPlaceholder="Tell Codex what to do differently"
          onSubmit={actions.answerUserInput}
          onCancel={actions.cancelUserInput}
          cancelLabel="Stop this turn"
        />
        {!slot.request.isBlocking && slot.composer ? <ComposerInput viewModel={slot.composer} actions={actions} capabilities={capabilities} /> : null}</div>
      ) : visibleFinalPlan && slot.kind === 'final-plan' ? (
        <div className="px-2">
          <Questionnaire
            key={`final-plan:${planKey}`}
            questions={[
              {
                id: 'plan-confirmation',
                question: 'Implement this plan?',
                options: [{ label: 'Yes, implement this plan', recommended: false }],
              },
            ]}
            inputPlaceholder="No, and tell what to do differently"
            onSubmit={async (answers: QuestionnaireAnswer) => {
              const answer = answers['plan-confirmation']?.answers[0]?.trim()
              if (!answer) return
              if (actions.submitWithMode) await actions.submitWithMode(answer, 'default')
              else await actions.submit(answer, [])
            }}
            onCancel={async () => setDismissedPlan(planKey)}
            onSkip={async () => setDismissedPlan(planKey)}
          />
        </div>
      ) : slot.kind === 'final-plan' ? (
        <ComposerInput viewModel={slot.composer} actions={actions} capabilities={capabilities} />
      ) : slot.kind === 'input' ? (
        <ComposerInput viewModel={slot.composer} actions={actions} capabilities={capabilities} />
      ) : null}
    </ComposerContainer>
  )
}
