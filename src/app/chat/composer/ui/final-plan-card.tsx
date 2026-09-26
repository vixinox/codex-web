import { CheckIcon, ChevronDownIcon, PlayIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import { MessageContent } from '@/app/chat/content/message-content'
import type { ChatPlanPresentation } from '@/app/chat/model/types'

export function FinalPlanCard({
  plan,
  onExecute,
  onRevise,
  onClose,
}: {
  plan: ChatPlanPresentation
  onExecute: () => void
  onRevise: () => void
  onClose: () => void
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const hasDetails = Boolean(plan.text || plan.steps.length)
  return (
    <section className="mb-3 w-full rounded-lg border border-app-border bg-app-surface-raised p-4 text-foreground">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-app-surface-subtle">
          <CheckIcon className="size-4 text-success" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">Plan ready for review</h2>
          {plan.explanation ? (
            <p className="mt-1 text-sm text-app-text-muted">{plan.explanation}</p>
          ) : null}
        </div>
        {hasDetails ? (
          <button
            type="button"
            className="app-interactive inline-flex size-8 shrink-0 items-center justify-center rounded-full text-app-text-muted"
            aria-label={detailsOpen ? 'Hide plan details' : 'Show plan details'}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <ChevronDownIcon
              className={`size-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
            />
          </button>
        ) : null}
      </div>
      {detailsOpen ? (
        <div className="mt-3 min-w-0 border-t border-app-border pt-3">
          {plan.text ? <MessageContent text={plan.text} /> : null}
          {!plan.text && plan.steps.length ? (
            <ol className="flex flex-col gap-2 text-sm">
              {plan.steps.map((step, index) => (
                <li key={`${step.step}-${index}`} className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-app-text-muted">{index + 1}.</span>
                  <span className="min-w-0 break-words">{step.step}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="app-interactive inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-app-text-muted"
          onClick={onClose}
        >
          <XIcon className="size-4" aria-hidden="true" /> Close
        </button>
        <button
          type="button"
          className="app-interactive inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground"
          onClick={onRevise}
        >
          <RotateCcwIcon className="size-4" aria-hidden="true" /> Revise plan
        </button>
        <button
          type="button"
          className="app-interactive inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={onExecute}
        >
          <PlayIcon className="size-4" aria-hidden="true" /> Continue
        </button>
      </div>
    </section>
  )
}
