import { CircleCheckIcon, CircleIcon, LoaderCircleIcon } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useCanHover } from '@/lib/platform/browser/use-can-hover'
import type { ChatPlanPresentation } from '@/app/chat/model/types'

export function PlanPanel({ plan }: { plan: ChatPlanPresentation }) {
  const currentStep = getCurrentStep(plan.steps)
  const stats = plan.diffStats
  const canHover = useCanHover()
  const trigger = (
    <button
      type="button"
      className="app-interactive inline-flex min-h-12 items-center gap-2 rounded-3xl border border-app-border bg-app-surface-raised px-4 text-sm text-app-text-muted shadow-[0_2px_12px_var(--app-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label="Show plan details"
    />
  )
  const details = (
    <ol className="flex flex-col gap-2">
      {plan.steps.map((step, index) => (
        <li key={`${step.step}-${index}`} className="flex min-w-0 items-center gap-3 text-sm">
          <PlanStepIcon status={step.status} />
          <span className="min-w-0 truncate">{step.step}</span>
        </li>
      ))}
    </ol>
  )
  return (
    <div className="mb-2 flex w-full justify-end">
      {canHover ? (
        <HoverCard>
          <HoverCardTrigger render={trigger}>
            <LoaderCircleIcon
              className="size-5 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
            <span>
              Step {currentStep} / {plan.steps.length}
            </span>
            {stats.files > 0 ? (
              <>
                <span className="text-app-text-muted">·</span>
                <span>
                  {stats.files} {stats.files === 1 ? 'file changed' : 'files changed'}
                </span>
                <span className="text-diff-added">+{stats.additions}</span>
                <span className="text-diff-removed">-{stats.deletions}</span>
              </>
            ) : null}
          </HoverCardTrigger>
          <HoverCardContent
            side="top"
            align="end"
            className="w-[min(30rem,calc(100vw-2rem))] bg-app-surface-raised p-3 text-app-text-muted"
          >
            {details}
          </HoverCardContent>
        </HoverCard>
      ) : (
        <Popover>
          <PopoverTrigger render={trigger}>
            <LoaderCircleIcon
              className="size-5 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
            <span>
              Step {currentStep} / {plan.steps.length}
            </span>
            {stats.files > 0 ? (
              <>
                <span className="text-app-text-muted">·</span>
                <span>
                  {stats.files} {stats.files === 1 ? 'file changed' : 'files changed'}
                </span>
                <span className="text-diff-added">+{stats.additions}</span>
                <span className="text-diff-removed">-{stats.deletions}</span>
              </>
            ) : null}
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="w-[min(30rem,calc(100vw-2rem))] bg-app-surface-raised p-3 text-app-text-muted"
          >
            {details}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function getCurrentStep(steps: ChatPlanPresentation['steps']) {
  const active = steps.findIndex((step) => step.status === 'inProgress')
  if (active >= 0) return active + 1
  const pending = steps.findIndex((step) => step.status === 'pending')
  return pending >= 0 ? pending + 1 : steps.length
}

function PlanStepIcon({ status }: { status: ChatPlanPresentation['steps'][number]['status'] }) {
  if (status === 'completed')
    return <CircleCheckIcon className="size-4 shrink-0 text-success" aria-hidden="true" />
  if (status === 'inProgress')
    return (
      <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
    )
  return <CircleIcon className="size-4 shrink-0 text-app-text-muted" aria-hidden="true" />
}
