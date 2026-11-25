import * as React from 'react'
import { ThreadBlock, UserContent, LiveRow } from './thread-block'
import {
  AlertCircleIcon,
  BracesIcon,
  ChevronRightIcon,
  LightbulbIcon,
  Maximize2Icon,
  Minimize2Icon,
} from 'lucide-react'
import { CopyButton } from '@/components/shared/copy-button'
import { useCanHover } from '@/lib/platform/browser/use-can-hover'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MessageContent } from '@/app/chat/content/message-content'
import {
  useThreadSessionSnapshot,
  type ThreadSession,
} from '@/app/chat/session/state/thread-session-store'
import type {
  ChatBlock,
  ChatThreadPresentation,
  ChatTurnPresentation,
  ChatUserInputRequest,
} from '../model/types'
import {
  QuestionnairePendingStatus,
  QuestionnaireSummary,
  WorkSummary,
} from './thread-assets-parts'
import { TranscriptCollapsibleContent } from './transcript-collapsible'
import {
  formatTurnTimestamp,
  formatUserContentForCopy,
  hasAssistantText,
  visibleTurnContent,
  withoutReasoningSummaryActivity,
} from './thread-assets-utils'

export const ThreadAssets = React.memo(function ThreadAssets({
  thread,
  session,
  retryState,
  lockEpoch,
  compacting,
  pendingAccepted = true,
  initialScrollPosition = 'bottom',
}: {
  thread: ChatThreadPresentation
  session?: ThreadSession
  retryState?: { attempt: number; maxAttempts: number } | null
  lockEpoch?: number
  compacting?: boolean
  pendingAccepted?: boolean
  initialScrollPosition?: 'top' | 'bottom'
}) {
  const assetsRef = React.useRef<HTMLDivElement>(null)
  const scrollParentRef = React.useRef<HTMLElement | null>(null)
  const scrollLockedRef = React.useRef(initialScrollPosition === 'bottom')
  const previousLockRequestRef = React.useRef<number | null>(null)
  const sessionSnapshot = useThreadSessionSnapshot(session ?? null)
  const displayThread = thread
  const turnOrder = displayThread.turns.map((turn) => turn.id)

  React.useLayoutEffect(() => {
    const assets = assetsRef.current
    if (!assets) return
    let parent: HTMLElement | null = assets.parentElement
    while (parent) {
      const overflowY = window.getComputedStyle(parent).overflowY
      if (
        overflowY === 'auto' ||
        overflowY === 'scroll' ||
        parent.scrollHeight > parent.clientHeight
      )
        break
      parent = parent.parentElement
    }
    if (!parent) return
    scrollParentRef.current = parent
    const updateScrollLock = () => {
      scrollLockedRef.current = isAtBottom(parent)
    }
    if (initialScrollPosition === 'top') parent.scrollTop = 0
    const resizeObserver = new ResizeObserver(() => {
      if (scrollLockedRef.current) scrollToBottom(parent)
    })
    parent.addEventListener('scroll', updateScrollLock, { passive: true })
    resizeObserver.observe(assets)
    resizeObserver.observe(parent)
    return () => {
      parent.removeEventListener('scroll', updateScrollLock)
      resizeObserver.disconnect()
      if (scrollParentRef.current === parent) scrollParentRef.current = null
    }
  }, [initialScrollPosition])

  React.useLayoutEffect(() => {
    const parent = scrollParentRef.current
    const nextRequest = lockEpoch ?? 0
    if (!parent || previousLockRequestRef.current === nextRequest) return
    previousLockRequestRef.current = nextRequest
    scrollLockedRef.current = true
    scrollToBottom(parent)
  }, [lockEpoch])

  return (
    <div ref={assetsRef} className="flex-1 pt-16 pb-20">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
        {turnOrder.length ? (
          displayThread.turns.map((turn, index) => (
            <ThreadTurn
              key={`${displayThread.id}:${turn.presentationId ?? turn.id}`}
              turn={turn}
              compacting={compacting}
              retryState={index === turnOrder.length - 1 ? retryState : null}
              pendingQuestionnaire={
                displayThread.userInput?.turnId === turn.id ? displayThread.userInput : undefined
              }
              accepted={index !== turnOrder.length - 1 || pendingAccepted}
              animateLive={!session || sessionSnapshot.updateSource === 'live'}
            />
          ))
        ) : (
          <p className="py-20 text-center text-sm text-app-text-muted">Start a new conversation</p>
        )}
        {compacting &&
        !(session ? sessionSnapshot.hasCompactionTurn : hasCompactionTurn(displayThread)) ? (
          <LiveRow label="Context compacting" />
        ) : null}
      </div>
    </div>
  )
})

function hasCompactionTurn(thread: ChatThreadPresentation) {
  return thread.turns.some((turn) =>
    turn.blocks.some((block) => block.type === 'article' && block.kind === 'context-compaction'),
  )
}

function isAtBottom(parent: HTMLElement) {
  return parent.scrollHeight - parent.scrollTop - parent.clientHeight <= 32
}

function scrollToBottom(parent: HTMLElement) {
  parent.scrollTop = Math.max(0, parent.scrollHeight - parent.clientHeight)
}

const ThreadTurn = React.memo(function ThreadTurn({
  turn,
  compacting = false,
  retryState,
  pendingQuestionnaire,
  accepted = true,
  animateLive = false,
}: {
  animateLive?: boolean
  turn: ChatTurnPresentation
  compacting?: boolean
  retryState?: { attempt: number; maxAttempts: number } | null
  pendingQuestionnaire?: ChatUserInputRequest
  accepted?: boolean
}) {
  const canHover = useCanHover()
  const [detailsOpen, setDetailsOpen] = React.useState(turn.status === 'inProgress')
  const [planOpen, setPlanOpen] = React.useState(false)
  const [planContentHeight, setPlanContentHeight] = React.useState(0)
  const [animateAssistant, setAnimateAssistant] = React.useState(false)
  const wasWorkingRef = React.useRef(turn.status === 'inProgress')
  const planContentRef = React.useRef<HTMLDivElement>(null)
  // Assistant messages can move between the trailing answer and process content.
  // Keep their animation history across those component remounts, scoped to this turn.
  const animatedMarkdownByMessageRef = React.useRef(new Map<string, Set<string>>())
  const animatedMarkdownBlocks = (messageId: string) => {
    let blocks = animatedMarkdownByMessageRef.current.get(messageId)
    if (!blocks) {
      blocks = new Set<string>()
      animatedMarkdownByMessageRef.current.set(messageId, blocks)
    }
    return blocks
  }
  const working = turn.status === 'inProgress'
  const seenToolTitlesRef = React.useRef(new Set<string>())
  const toolCallAnimation = React.useMemo(
    () => ({ animate: animateLive, seen: seenToolTitlesRef.current }),
    [animateLive],
  )
  React.useEffect(() => {
    if (!animateLive) {
      setAnimateAssistant(false)
    } else if (working || wasWorkingRef.current) {
      setAnimateAssistant(true)
    }
    wasWorkingRef.current = working
  }, [animateLive, working])
  const finalPlan = turn.plan?.final ? turn.plan : undefined
  React.useLayoutEffect(() => {
    const content = planContentRef.current
    if (!content) return
    const updateHeight = () => setPlanContentHeight(content.scrollHeight + 13)
    updateHeight()
    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(content)
    return () => resizeObserver.disconnect()
  }, [finalPlan?.explanation, finalPlan?.text, finalPlan?.steps])
  const firstUser = turn.blocks.find((block) => block.type === 'user')
  const visibleContent = visibleTurnContent(turn, pendingQuestionnaire, finalPlan)
  const trailingAssistantId = visibleContent.trailingAssistantId
  const finalAssistant =
    [...turn.blocks]
      .reverse()
      .find(
        (block): block is Extract<ChatBlock, { type: 'assistant' }> =>
          block.type === 'assistant' && block.final === true,
      ) ??
    (working && trailingAssistantId
      ? [...turn.blocks]
          .reverse()
          .find(
            (block): block is Extract<ChatBlock, { type: 'assistant' }> =>
              block.id === trailingAssistantId && block.type === 'assistant',
          )
      : undefined)
  const process = turn.blocks
    .filter(
      (block) =>
        block !== firstUser &&
        block.id !== finalAssistant?.id &&
        !(
          block.type === 'assistant' &&
          !block.text.trim() &&
          !block.parts?.some((part) => part.type !== 'text')
        ),
    )
    .flatMap((block) => {
      const renderableBlock = withoutReasoningSummaryActivity(block)
      return renderableBlock ? [renderableBlock] : []
    })
  const copyText = turn.blocks
    .filter((block) => block.type === 'assistant')
    .map((block) => block.text)
    .concat(finalPlan?.text ?? [])
    .join('\n\n')
  const planCopyText = [
    finalPlan?.explanation,
    finalPlan?.text,
    finalPlan?.steps.length
      ? finalPlan.steps.map((step, index) => `${index + 1}. ${step.step}`).join('\n')
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n')
  const userCopyText = firstUser ? formatUserContentForCopy(firstUser.content) : ''
  const hasRunningCompaction = turn.blocks.some(
    (block) =>
      block.type === 'article' && block.kind === 'context-compaction' && block.status === 'running',
  )
  const hasCompactionBlock = turn.blocks.some(
    (block) => block.type === 'article' && block.kind === 'context-compaction',
  )
  const isCompactionTurn = hasCompactionBlock || (compacting && !firstUser)
  const hasRunningActivity = turn.blocks.some(
    (block) =>
      block.type === 'activity' &&
      block.activities.some((activity) => activity.status === 'running'),
  )
  const finishAssistantAnimation = React.useCallback(() => {
    if (!working) setAnimateAssistant(false)
  }, [working])
  const showThinking =
    working &&
    (!accepted || !hasAssistantText(turn)) &&
    !compacting &&
    !hasCompactionBlock &&
    !hasRunningActivity &&
    !hasRunningCompaction &&
    !retryState &&
    !pendingQuestionnaire &&
    !turn.error
  const showWorkSummary = accepted && Boolean(firstUser) && !isCompactionTurn
  const showSeparator = accepted && Boolean(firstUser) && !isCompactionTurn
  const processOpen = detailsOpen
  const processBlocks: React.ReactNode[] = []
  let questionnaireRendered = false
  const renderQuestionnaire = () => {
    if ((!turn.questionnaires?.length && !turn.questionnaire) || questionnaireRendered) return
    questionnaireRendered = true
    for (const summary of turn.questionnaires ?? (turn.questionnaire ? [turn.questionnaire] : []))
      processBlocks.push(<QuestionnaireSummary key={String(summary.requestId)} summary={summary} />)
  }
  let processGroup: ChatBlock[] = []
  const flushProcessGroup = () => {
    if (!processGroup.length) return
    const group = processGroup
    processGroup = []
    processBlocks.push(
      <div key={`process-${group[0].id}`} className="min-h-0">
        <div className="flex min-w-0 flex-col gap-2">
          {group.map((block) => (
            <ThreadBlock
              key={block.id}
              block={block}
              streaming={working}
              animate={animateLive && (working || animateAssistant)}
              animatedMarkdownBlocks={
                block.type === 'assistant' ? animatedMarkdownBlocks(block.id) : undefined
              }
              toolCallAnimation={toolCallAnimation}
              onAssistantSettled={
                block.type === 'assistant' && block.id === trailingAssistantId
                  ? finishAssistantAnimation
                  : undefined
              }
            />
          ))}
        </div>
      </div>,
    )
  }
  for (const originalBlock of process) {
    const block = withoutReasoningSummaryActivity(originalBlock)
    if (!block) continue
    processGroup.push(block)
  }
  flushProcessGroup()
  renderQuestionnaire()
  if (retryState) {
    processBlocks.push(
      <LiveRow
        key="retry"
        label={`Retrying connection · ${retryState.attempt}/${retryState.maxAttempts}`}
        network
      />,
    )
  }

  const turnTimestamp = formatTurnTimestamp(turn.completedAt ?? turn.startedAt)

  return (
    <article
      className="group flex flex-col"
      data-ui-target={turn.id}
      data-ui-source="chat/transcript/thread-assets.tsx"
    >
      {firstUser?.type === 'user' ? (
        <div className="group/user-message ml-auto flex max-w-[85%] flex-col items-end">
          <UserSnippetCards content={firstUser.content} />
          <div className="rounded-2xl bg-app-surface-raised px-4 py-2 text-sm text-foreground">
            <UserContent content={firstUser.content} />
          </div>
          {userCopyText ? (
            <div
              className={`mt-2 flex items-center gap-1 transition-opacity ${
                canHover ? 'opacity-0 group-hover/user-message:opacity-100' : 'opacity-100'
              }`}
            >
              {turnTimestamp ? (
                <time className="text-xs text-app-text-muted select-none">{turnTimestamp}</time>
              ) : null}
              <CopyButton
                variant="ghost"
                size="icon"
                text={userCopyText}
                className="h-7 w-7"
                aria-label="Copy message"
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <Collapsible open={processOpen} onOpenChange={setDetailsOpen}>
        {showWorkSummary ? (
          <WorkSummary
            turn={turn}
            expandable={Boolean(
              process.length || turn.questionnaires?.length || turn.questionnaire,
            )}
            detailsOpen={detailsOpen}
            hasRunningCompaction={hasRunningCompaction}
          />
        ) : null}
        {showSeparator ? <Separator className="my-2" /> : null}
        {processBlocks.length ? (
          <TranscriptCollapsibleContent>
            <div className="mt-2 flex min-w-0 flex-col gap-2">{processBlocks}</div>
          </TranscriptCollapsibleContent>
        ) : null}
      </Collapsible>
      {pendingQuestionnaire && working ? <QuestionnairePendingStatus /> : null}
      {finalAssistant ? (
        <div className="mt-2 max-w-full min-w-0">
          <ThreadBlock
            block={finalAssistant}
            streaming={working}
            animate={animateLive && (working || animateAssistant)}
            animatedMarkdownBlocks={animatedMarkdownBlocks(finalAssistant.id)}
            onAssistantSettled={
              finalAssistant.id === trailingAssistantId ? finishAssistantAnimation : undefined
            }
          />
        </div>
      ) : null}
      {showThinking ? <LiveRow label="Thinking" /> : null}
      {finalPlan ? (
        <section className="mt-2 flex min-w-0 flex-col rounded-lg border border-app-border bg-app-surface-raised p-4 text-foreground">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <PlanIcon />
            <span>Plan</span>
            <div className="ml-auto flex items-center gap-1">
              {planCopyText ? (
                <CopyButton
                  variant="ghost"
                  size="icon"
                  text={planCopyText}
                  className="size-8"
                  aria-label="Copy plan"
                />
              ) : null}
              <button
                type="button"
                className="app-interactive inline-flex size-8 shrink-0 items-center justify-center rounded-full text-app-text-muted"
                aria-label={planOpen ? 'Collapse plan' : 'Expand plan'}
                aria-expanded={planOpen}
                onClick={() => setPlanOpen((open) => !open)}
              >
                {planOpen ? (
                  <Minimize2Icon className="size-4" aria-hidden="true" />
                ) : (
                  <Maximize2Icon className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-label={planOpen ? 'Collapse plan details' : 'Expand plan details'}
            onClick={() => setPlanOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setPlanOpen((open) => !open)
              }
            }}
            className={`mt-2 min-w-0 overflow-hidden border-t border-app-border pt-3 transition-[height,opacity] duration-300 ease-out motion-reduce:transition-none ${planOpen ? 'opacity-100' : 'opacity-75'}`}
            style={{ height: planOpen ? planContentHeight : '4rem' }}
          >
            <div ref={planContentRef}>
              {finalPlan.explanation ? (
                <p className="text-sm text-app-text-muted">{finalPlan.explanation}</p>
              ) : null}
              {finalPlan.text ? <MessageContent text={finalPlan.text} /> : null}
              {!finalPlan.text && finalPlan.steps.length ? (
                <ol className="flex flex-col gap-2 text-sm">
                  {finalPlan.steps.map((step, index) => (
                    <li key={`${step.step}-${index}`}>
                      {index + 1}. {step.step}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      {turn.error ? <TurnError error={turn.error} /> : null}
      {turn.status === 'completed' && copyText ? (
        <div
          className={`mt-2 flex items-center gap-1 transition-opacity ${
            canHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
          }`}
        >
          <CopyButton
            variant="ghost"
            size="icon"
            text={copyText}
            className="h-7 w-7"
            aria-label="Copy response"
          />
          {turnTimestamp ? (
            <time className="text-xs text-app-text-muted select-none">{turnTimestamp}</time>
          ) : null}
        </div>
      ) : null}
    </article>
  )
})

function TurnError({ error }: { error: NonNullable<ChatTurnPresentation['error']> }) {
  const [open, setOpen] = React.useState(false)
  const details = [error.message, error.details ? formatErrorDetails(error.details) : undefined]
    .filter(Boolean)
    .join('\n\n')
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2" role="alert">
      <CollapsibleTrigger className="group inline-flex max-w-full items-center gap-2 text-left text-xs text-app-text-muted">
        <AlertCircleIcon className="size-4 shrink-0" />
        <span className="min-w-0">Turn failed</span>
        <ChevronRightIcon
          className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <TranscriptCollapsibleContent>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md border border-app-border bg-app-surface-raised p-3 pl-6 text-xs leading-5 text-foreground">
          {details}
        </pre>
      </TranscriptCollapsibleContent>
    </Collapsible>
  )
}

function formatErrorDetails(details: string) {
  try {
    const parsed: unknown = JSON.parse(details)
    if (parsed && typeof parsed === 'object') return formatErrorValue(parsed)
  } catch {
    // Preserve upstream text when it is not JSON.
  }
  return details
}

function formatErrorValue(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (entry && typeof entry === 'object')
          return `${indent}${index + 1}.\n${formatErrorValue(entry, `${indent}  `)}`
        return `${indent}${index + 1}. ${formatErrorScalar(entry)}`
      })
      .join('\n')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !(indent === '' && key === 'message'))
      .map(([key, entry]) => {
        const label = humanizeErrorKey(key)
        if (entry && typeof entry === 'object')
          return `${indent}${label}:\n${formatErrorValue(entry, `${indent}  `)}`
        return `${indent}${label}: ${formatErrorScalar(entry)}`
      })
      .join('\n')
  }
  return `${indent}${formatErrorScalar(value)}`
}

function formatErrorScalar(value: unknown) {
  if (value === null) return 'None'
  if (typeof value === 'string') return value.slice(0, 2000)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value)
  if (value === undefined) return 'Unknown'
  return '[Unsupported value]'
}

function humanizeErrorKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function PlanIcon() {
  return (
    <span className="inline-flex size-5 items-center justify-center text-app-text-muted">
      <LightbulbIcon className="size-3.5" aria-hidden="true" />
    </span>
  )
}

function UserSnippetCards({
  content,
}: {
  content: Extract<ChatBlock, { type: 'user' }>['content']
}) {
  const snippets = content.filter((item) => item.type === 'codeSnippet')
  if (snippets.length === 0) return null
  const visible = snippets.slice(0, 3)
  return (
    <div
      className="mb-2 flex max-w-full items-center gap-2 overflow-hidden"
      role="list"
      aria-label="Code snippets"
    >
      {visible.map((snippet, index) => (
        <div
          key={`${snippet.title}-${index}`}
          role="listitem"
          className="flex w-52 min-w-0 items-center gap-2 rounded-lg border border-app-border bg-app-surface-raised p-2 text-left"
        >
          <BracesIcon className="size-4 shrink-0 text-app-text-muted" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs text-foreground">{snippet.title}</span>
        </div>
      ))}
      {snippets.length > 3 ? (
        <span className="shrink-0 text-xs text-app-text-muted">+{snippets.length - 3}</span>
      ) : null}
    </div>
  )
}
