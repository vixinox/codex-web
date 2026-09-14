import * as React from 'react'
import { ThreadBlock, UserContent, LiveRow } from './thread-block'
import { AlertCircleIcon, BracesIcon } from 'lucide-react'
import { CopyButton } from '@/components/shared/copy-button'
import { Separator } from '@/components/ui/separator'
import { Collapsible } from '@/components/ui/collapsible'
import { MessageContent } from '@/app/chat/content/message-content'
import {
  useThreadSessionSnapshot,
  type ThreadSession,
} from '@/app/chat/session/thread-session-store'
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

export const ThreadAssets = React.memo(
  function ThreadAssets({
    thread,
    session,
    retryState,
    lockEpoch,
    compacting,
  }: {
    thread: ChatThreadPresentation
    session?: ThreadSession
    retryState?: { attempt: number; maxAttempts: number } | null
    lockEpoch?: number
    compacting?: boolean
  }) {
    const assetsRef = React.useRef<HTMLDivElement>(null)
    const scrollParentRef = React.useRef<HTMLElement | null>(null)
    const scrollLockedRef = React.useRef(true)
    const previousLockRequestRef = React.useRef<number | null>(null)
    const latestUserBlockRef = React.useRef<string | null>(null)
    const sessionSnapshot = useThreadSessionSnapshot(session ?? null)
    const displayThread = thread
    const turnOrder = session
      ? sessionSnapshot.turnOrder
      : displayThread.turns.map((turn) => turn.id)
    const latestUserBlockId = session
      ? sessionSnapshot.latestUserBlockId
      : [...displayThread.turns]
          .reverse()
          .flatMap((turn) => [...turn.blocks].reverse())
          .find((block) => block.type === 'user')?.id

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
    }, [])

    React.useLayoutEffect(() => {
      const isNewUserMessage =
        latestUserBlockId !== undefined && latestUserBlockId !== latestUserBlockRef.current
      latestUserBlockRef.current = latestUserBlockId ?? null

      const parent = scrollParentRef.current
      if (!parent) return
      if (isNewUserMessage) scrollLockedRef.current = true
      if (scrollLockedRef.current) scrollToBottom(parent)
    }, [compacting, latestUserBlockId, retryState])

    React.useLayoutEffect(() => {
      const parent = scrollParentRef.current
      const nextRequest = lockEpoch ?? 0
      if (!parent || previousLockRequestRef.current === nextRequest) return
      previousLockRequestRef.current = nextRequest
      scrollLockedRef.current = true
      scrollToBottom(parent)
    }, [lockEpoch])

    return (
      <div ref={assetsRef} className="flex-1 pt-12 pb-20">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4">
          {turnOrder.length ? (
            turnOrder.map((turnId, index) =>
              session ? (
                <SessionThreadTurn
                  key={`${displayThread.id}:${turnId}`}
                  session={session}
                  turnId={turnId}
                  retryState={index === turnOrder.length - 1 ? retryState : null}
                  pendingQuestionnaire={
                    sessionSnapshot.userInput?.turnId === turnId
                      ? (sessionSnapshot.userInput as ChatUserInputRequest)
                      : undefined
                  }
                />
              ) : (
                <ThreadTurn
                  key={`${displayThread.id}:${displayThread.turns[index]?.presentationId ?? turnId}`}
                  turn={displayThread.turns[index]}
                  retryState={index === turnOrder.length - 1 ? retryState : null}
                  pendingQuestionnaire={
                    displayThread.userInput?.turnId === turnId ? displayThread.userInput : undefined
                  }
                />
              ),
            )
          ) : (
            <p className="py-20 text-center text-sm text-app-text-subtle">
              Start a new conversation
            </p>
          )}
          {compacting &&
          !(session ? sessionSnapshot.hasCompactionTurn : hasCompactionTurn(displayThread)) ? (
            <LiveRow label="Compacting" />
          ) : null}
        </div>
      </div>
    )
  },
  (previous, next) => {
    if (previous.session || next.session)
      return (
        previous.session === next.session &&
        previous.retryState === next.retryState &&
        previous.lockEpoch === next.lockEpoch &&
        previous.compacting === next.compacting &&
        sameTurnShape(previous.thread, next.thread)
      )
    return (
      previous.thread === next.thread &&
      previous.retryState === next.retryState &&
      previous.lockEpoch === next.lockEpoch &&
      previous.compacting === next.compacting
    )
  },
)

function hasCompactionTurn(thread: ChatThreadPresentation) {
  return thread.turns.some((turn) =>
    turn.blocks.some((block) => block.type === 'article' && block.kind === 'context-compaction'),
  )
}

function sameTurnShape(left: ChatThreadPresentation, right: ChatThreadPresentation) {
  return (
    left.id === right.id &&
    left.turns.length === right.turns.length &&
    left.turns.every(
      (turn, index) =>
        turn.presentationId === right.turns[index]?.presentationId &&
        turn.id === right.turns[index]?.id,
    )
  )
}

function isAtBottom(parent: HTMLElement) {
  return parent.scrollHeight - parent.scrollTop - parent.clientHeight <= 32
}

function scrollToBottom(parent: HTMLElement) {
  parent.scrollTop = Math.max(0, parent.scrollHeight - parent.clientHeight)
}

const SessionThreadTurn = React.memo(function SessionThreadTurn({
  session,
  turnId,
  retryState,
  pendingQuestionnaire,
}: {
  session: ThreadSession
  turnId: string
  retryState?: { attempt: number; maxAttempts: number } | null
  pendingQuestionnaire?: ChatUserInputRequest
}) {
  const snapshot = useThreadSessionSnapshot(session)
  const turn = snapshot.turnsById[turnId]
  if (!turn) return null
  return (
    <ThreadTurn
      turn={turn as unknown as ChatTurnPresentation}
      retryState={retryState}
      pendingQuestionnaire={pendingQuestionnaire}
    />
  )
})

const ThreadTurn = React.memo(function ThreadTurn({
  turn,
  retryState,
  pendingQuestionnaire,
}: {
  turn: ChatTurnPresentation
  retryState?: { attempt: number; maxAttempts: number } | null
  pendingQuestionnaire?: ChatUserInputRequest
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [animateAssistant, setAnimateAssistant] = React.useState(false)
  const previousStatusRef = React.useRef(turn.status)
  React.useLayoutEffect(() => {
    const enteredTerminal =
      previousStatusRef.current === 'inProgress' && turn.status !== 'inProgress'
    if (enteredTerminal) {
      setDetailsOpen(false)
      setAnimateAssistant(true)
      previousStatusRef.current = turn.status
    }
    if (turn.status === 'inProgress') {
      setAnimateAssistant(false)
    }
    previousStatusRef.current = turn.status
  }, [turn.status])
  const firstUser = turn.blocks.find((block) => block.type === 'user')
  const process = turn.blocks
    .filter((block) => block !== firstUser && !(block.type === 'assistant' && block.final))
    .flatMap((block) => {
      const renderableBlock = withoutReasoningSummaryActivity(block)
      return renderableBlock ? [renderableBlock] : []
    })
  const finalAssistant = [...turn.blocks]
    .reverse()
    .find(
      (block): block is Extract<ChatBlock, { type: 'assistant' }> =>
        block.type === 'assistant' && block.final === true,
    )
  const finalPlan = turn.plan?.final ? turn.plan : undefined
  const copyText = turn.blocks
    .filter((block) => block.type === 'assistant')
    .map((block) => block.text)
    .concat(finalPlan?.text ?? [])
    .join('\n\n')
  const userCopyText = firstUser ? formatUserContentForCopy(firstUser.content) : ''
  const working = turn.status === 'inProgress'
  const hasRunningCompaction = turn.blocks.some(
    (block) =>
      block.type === 'article' && block.kind === 'context-compaction' && block.status === 'running',
  )
  const hasProcess = Boolean(
    process.length || retryState || finalAssistant || finalPlan || turn.questionnaire,
  )
  const visibleContent = visibleTurnContent(turn, pendingQuestionnaire, finalPlan)
  const hasVisibleContent = visibleContent.hasContent
  const trailingAssistantId = visibleContent.trailingAssistantId
  const finishAssistantAnimation = React.useCallback(() => {
    if (!working) setAnimateAssistant(false)
  }, [working])
  const showThinking =
    working &&
    !hasAssistantText(turn) &&
    !hasRunningCompaction &&
    !retryState &&
    !pendingQuestionnaire &&
    !turn.error
  const showWorkSummary = !working || hasVisibleContent
  const showSeparator = hasProcess && (!working || hasVisibleContent)
  const processOpen = working || detailsOpen
  const processBlocks: React.ReactNode[] = []
  let questionnaireRendered = false
  const renderQuestionnaire = () => {
    if (!turn.questionnaire || questionnaireRendered) return
    questionnaireRendered = true
    processBlocks.push(<QuestionnaireSummary key="questionnaire" summary={turn.questionnaire} />)
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
              animate={working || animateAssistant}
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
    <article className="group flex flex-col">
      {firstUser?.type === 'user' ? (
        <div className="group/user-message ml-auto flex max-w-[85%] flex-col items-end">
          <UserSnippetCards content={firstUser.content} />
          <div className="rounded-2xl bg-app-surface-raised px-4 py-2 text-sm text-foreground">
            <UserContent content={firstUser.content} />
          </div>
          {userCopyText ? (
            <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/user-message:opacity-100">
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
            expandable={
              Boolean(turn.questionnaire) ||
              (process.length > 0 && Boolean(finalAssistant || finalPlan))
            }
            detailsOpen={detailsOpen}
            hasRunningCompaction={hasRunningCompaction}
          />
        ) : null}
        {showSeparator ? <Separator className="mt-2" /> : null}
        {processBlocks.length ? (
          <TranscriptCollapsibleContent>
            <div className="mt-2 flex min-w-0 flex-col gap-2">{processBlocks}</div>
          </TranscriptCollapsibleContent>
        ) : null}
      </Collapsible>
      {pendingQuestionnaire && working ? (
        <QuestionnairePendingStatus questionCount={pendingQuestionnaire.questions.length} />
      ) : null}
      {finalAssistant ? (
        <div className="mt-2 min-w-0">
          <ThreadBlock
            block={finalAssistant}
            streaming={working}
            animate={working || animateAssistant}
            onAssistantSettled={
              finalAssistant.id === trailingAssistantId ? finishAssistantAnimation : undefined
            }
          />
        </div>
      ) : null}
      {showThinking ? <LiveRow label="Thinking" /> : null}
      {finalPlan ? (
        <div className="flex flex-col gap-3 rounded-lg p-4 text-background">
          {finalPlan.explanation ? (
            <p className="text-sm font-medium">{finalPlan.explanation}</p>
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
      ) : null}
      {turn.error ? (
        <div className="mt-2 flex items-start gap-2 text-sm" role="alert">
          <AlertCircleIcon className="mt-1 size-4 shrink-0" />
          <div>
            <div>{turn.error.message}</div>
            {turn.error.details ? <div className="mt-1 text-xs">{turn.error.details}</div> : null}
          </div>
        </div>
      ) : null}
      {turn.status === 'completed' && copyText ? (
        <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
