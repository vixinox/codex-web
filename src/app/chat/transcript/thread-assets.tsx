import * as React from 'react'
import { ThreadBlock, UserContent, LiveRow } from './thread-block'
import { AlertCircleIcon } from 'lucide-react'
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
    const previousScrollTopRef = React.useRef(0)
    const previousLockRequestRef = React.useRef(lockEpoch ?? 0)
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
      previousScrollTopRef.current = parent.scrollTop
      const updateScrollLock = () => {
        const scrollTop = parent.scrollTop
        const scrollingUp = scrollTop < previousScrollTopRef.current
        if (scrollingUp && scrollLockedRef.current) scrollLockedRef.current = false
        else if (!scrollLockedRef.current && isAtBottom(parent)) scrollLockedRef.current = true
        previousScrollTopRef.current = scrollTop
      }
      parent.addEventListener('scroll', updateScrollLock, { passive: true })
      return () => parent.removeEventListener('scroll', updateScrollLock)
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
  const previousStatusRef = React.useRef(turn.status)
  React.useLayoutEffect(() => {
    if (previousStatusRef.current === 'inProgress' && turn.status === 'completed') {
      setDetailsOpen(false)
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
  const visibleRevision = visibleContent.revision
  const hasVisibleContent = visibleContent.hasContent
  const trailingAssistantId = visibleContent.trailingAssistantId
  const [settledRevision, setSettledRevision] = React.useState<string | null>(null)
  const hasTrailingAssistant = trailingAssistantId !== undefined
  React.useEffect(() => {
    if (!hasVisibleContent || hasTrailingAssistant) return
    const frame = window.requestAnimationFrame(() => setSettledRevision(visibleRevision))
    return () => window.cancelAnimationFrame(frame)
  }, [hasTrailingAssistant, hasVisibleContent, visibleRevision])
  const settleTrailingAssistant = React.useCallback(
    (revision: string) => {
      if (revision === visibleRevision) setSettledRevision(revision)
    },
    [visibleRevision],
  )
  const showThinking =
    working &&
    !hasRunningCompaction &&
    !retryState &&
    !pendingQuestionnaire &&
    !turn.error &&
    (!hasVisibleContent || settledRevision === visibleRevision)
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
              onAssistantSettled={
                block.type === 'assistant' && block.id === trailingAssistantId
                  ? () => settleTrailingAssistant(visibleRevision)
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
  if (showThinking) processBlocks.push(<LiveRow key="thinking" label="Thinking" />)

  const turnTimestamp = formatTurnTimestamp(turn.completedAt ?? turn.startedAt)

  return (
    <article className="group flex flex-col">
      {firstUser?.type === 'user' ? (
        <div className="group/user-message ml-auto flex max-w-[85%] flex-col items-end">
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
            onAssistantSettled={
              finalAssistant.id === trailingAssistantId
                ? () => settleTrailingAssistant(visibleRevision)
                : undefined
            }
          />
        </div>
      ) : null}
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
