import { ComposerContainer } from '@/app/composition/layout/composer-container'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ComposerInput } from '@/app/chat/composer/composer-input'
import { OWNER_THREAD_COMPOSER_CAPABILITIES } from '@/app/chat/composer/composer-capabilities'
import { PlanPanel } from '@/app/chat/composer/plan-panel'
import { Questionnaire } from '@/app/chat/questionnaire/user-input-questionnaire'
import type { ComposerActions, ThreadComposerSlotModel } from '@/app/chat/model/composer-types'

export function ThreadComposerSlot({
  slot,
  actions,
}: {
  slot: ThreadComposerSlotModel
  actions: ComposerActions & {
    retry: () => void
    answerUserInput: (answers: Record<string, { answers: string[] }>) => Promise<void>
    cancelUserInput: () => Promise<void>
  }
}) {
  return (
    <ComposerContainer>
      {slot.kind === 'error' ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{slot.message}</AlertDescription>
        </Alert>
      ) : null}
      {slot.kind === 'input' && slot.plan ? <PlanPanel plan={slot.plan} /> : null}
      {slot.kind === 'questionnaire' ? (
        <Questionnaire
          key={`${String(slot.request.requestId)}:${slot.request.questions.map((question) => question.id).join('|')}`}
          questions={slot.request.questions}
          inputPlaceholder="Tell Codex what to do differently"
          onSubmit={actions.answerUserInput}
          onCancel={actions.cancelUserInput}
        />
      ) : slot.kind === 'final-plan' ? (
        <Questionnaire
          key="final-plan"
          questions={[
            {
              id: 'action',
              question: 'Continue with this plan?',
              options: [
                {
                  value: 'execute',
                  label: 'Yes, implement this plan',
                  description: 'Start a new turn with write access.',
                },
              ],
            },
          ]}
          inputPlaceholder="No, and tell Codex what to do differently"
          onSubmit={async (answers) => {
            const answer = answers.action?.answers[0]
            if (answer === 'execute') {
              if (actions.submitWithMode)
                await actions.submitWithMode('Execute the plan above.', 'default')
              else await actions.submit('Execute the plan above.', [])
            } else if (answer) {
              if (actions.submitWithMode) await actions.submitWithMode(answer, 'plan')
              else await actions.submit(answer, [])
            }
          }}
        />
      ) : slot.kind === 'input' ? (
        <ComposerInput
          viewModel={slot.composer}
          actions={actions}
          capabilities={OWNER_THREAD_COMPOSER_CAPABILITIES}
        />
      ) : null}
    </ComposerContainer>
  )
}
