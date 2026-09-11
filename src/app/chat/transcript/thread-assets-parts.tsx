import * as React from 'react'
import { CheckCheckIcon, ChevronRightIcon, CircleHelpIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { getTurnWorkLabel } from '@/app/chat/projection/thread-work-summary'
import type { ChatTurnPresentation } from '../model/types'
import { TranscriptCollapsibleContent } from './transcript-collapsible'

export function QuestionnaireSummary({
  summary,
}: {
  summary: NonNullable<ChatTurnPresentation['questionnaire']>
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group min-w-0 text-sm">
        <CollapsibleTrigger className="inline-flex min-h-6 max-w-full items-center gap-2 text-left text-app-text-muted hover:text-foreground">
          <CircleHelpIcon className="size-3.5 shrink-0" />
          <span>Asked {summary.questionCount} questions</span>
          <ChevronRightIcon
            className={`size-3.5 transition-[opacity,transform] ${open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          />
        </CollapsibleTrigger>
        <TranscriptCollapsibleContent>
          <div className="my-2 flex flex-col gap-4 pl-5 text-app-text-subtle">
            {summary.questions.map((question, index) => (
              <div key={`${question.question}-${index}`} className="flex flex-col gap-1">
                <div>{question.question}</div>
                <div>
                  {question.answers.length ? question.answers.join(', ') : 'No answer provided'}
                </div>
              </div>
            ))}
          </div>
        </TranscriptCollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function QuestionnairePendingStatus({ questionCount }: { questionCount: number }) {
  return (
    <div className="mt-3 flex flex-col gap-3 text-sm text-app-text-subtle select-none">
      <div className="flex items-center gap-2">
        <CircleHelpIcon className="size-4 shrink-0" />
        <span>Asked {questionCount} questions</span>
      </div>
      <div className="flex items-center gap-2">
        <CircleHelpIcon className="size-4 shrink-0" />
        <span>Asking questions</span>
      </div>
      <div className="flex items-center gap-2">
        <CheckCheckIcon className="size-4 shrink-0" />
        <span>Waiting for your answer</span>
      </div>
    </div>
  )
}

export function WorkSummary({
  turn,
  expandable,
  detailsOpen,
  hasRunningCompaction,
}: {
  turn: ChatTurnPresentation
  expandable: boolean
  detailsOpen: boolean
  hasRunningCompaction: boolean
}) {
  const working = turn.status === 'inProgress'
  const nowMs = useWorkingClock(working)
  const label = getTurnWorkLabel(turn, nowMs, hasRunningCompaction)
  if (!label) return null
  if (working) return <span className="text-sm text-app-text-subtle select-none">{label}</span>
  if (!expandable) return <span className="text-sm text-app-text-subtle select-none">{label}</span>
  return (
    <CollapsibleTrigger className="group flex items-center self-start text-sm text-app-text-subtle select-none">
      <span>{label}</span>
      <ChevronRightIcon
        className={`ml-1 size-4.5 transition-[opacity,transform] ${detailsOpen ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      />
    </CollapsibleTrigger>
  )
}

function useWorkingClock(working: boolean) {
  const [nowMs, setNowMs] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!working) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [working])
  return nowMs
}
