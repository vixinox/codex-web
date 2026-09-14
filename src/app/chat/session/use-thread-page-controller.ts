import { useThreadDetailController } from './use-thread-detail-controller'
import {
  useThreadComposerController,
  type ThreadPageTarget,
} from './use-thread-composer-controller'
import { optimisticThread } from './thread-pending-reconciliation'
import { usePendingThreadPresentation } from './use-pending-thread-presentation'
import { useThreadSessionSnapshot } from './thread-session-store'
import { ownerThreadClient } from '@/lib/bridge/thread-adapters'
import type { ChatPlanPresentation, ChatUserInputRequest } from '@/app/chat/model/types'
import type { ThreadComposerSlotModel } from '@/app/chat/model/composer-types'

export type { ThreadPageTarget } from './use-thread-composer-controller'
export type ThreadPageControllerOptions = {
  userId: string
  target: ThreadPageTarget
  runtimeReady: boolean
  runtimeStatus?: string
  onNavigateToThread: (thread: {
    projectId: string | null
    threadId: string
    turnId: string
  }) => void
  onTurnAccepted: (turn: { projectId: string | null; threadId: string; turnId: string }) => void
  onUnavailable?: () => void
  onThreadLifecycle?: Parameters<typeof useThreadDetailController>[3]
  onThreadCreationStart?: (projectId: string | null, title: string) => string
  onThreadCreationFailed?: (placeholderId: string, message: string) => void
  onThreadCreationResolved?: (
    placeholderId: string,
    projectId: string | null,
    threadId: string,
  ) => void
}

export function useThreadPageController({
  userId,
  target,
  runtimeReady,
  runtimeStatus,
  onNavigateToThread,
  onTurnAccepted,
  onUnavailable,
  onThreadLifecycle,
  onThreadCreationStart,
  onThreadCreationFailed,
  onThreadCreationResolved,
}: ThreadPageControllerOptions) {
  const isThread = target.threadId !== null
  const detail = useThreadDetailController(
    ownerThreadClient,
    runtimeReady && isThread ? target.projectId : undefined,
    runtimeReady && isThread ? target.threadId : null,
    onUnavailable,
    onThreadLifecycle,
  )
  const detailSnapshot = useThreadSessionSnapshot(
    detail.model.status === 'ready' ? detail.model.session : null,
  )
  const readyThread = detail.model.status === 'ready' ? detail.model.thread : undefined
  const pending = usePendingThreadPresentation({ userId, target, thread: readyThread })
  // New Chat is a hard presentation boundary. Background work may continue,
  // but no pending/native Thread state from another target may surface here.
  // Newly-created chats navigate to their native Thread immediately, so the
  // transient optimistic bridge is not needed for the New Chat surface.
  const visiblePending = isThread ? pending : null
  const mergedThread = visiblePending?.thread
  const composer = useThreadComposerController({
    userId,
    runtimeReady,
    runtimeStatus,
    host: {
      target,
      activeTurnId: visiblePending?.activeNativeTurnId,
      followTurn: detail.followTurn,
      retry: detail.retry,
      navigateToThread: onNavigateToThread,
      onTurnAccepted,
      onUnavailable,
    },
    working: visiblePending?.working ?? false,
    tokenUsage: mergedThread?.tokenUsage,
    threadSelection: mergedThread
      ? { model: mergedThread.model, reasoningEffort: mergedThread.reasoningEffort }
      : undefined,
    onPendingChange: pending.onPendingChange,
    onThreadCreationStart,
    onThreadCreationFailed,
    onThreadCreationResolved,
  })

  const model = isThread
    ? mergedThread
      ? { status: 'ready' as const, thread: mergedThread }
      : pending.pending && pending.pending.nativeThreadId === target.threadId
        ? { status: 'starting' as const, thread: optimisticThread(pending.pending) }
        : detail.model.status === 'ready'
          ? { status: 'ready' as const, thread: readyThread! }
          : detail.model
    : { status: 'empty' as const, title: 'What should we build?' }

  const turns =
    detail.model.status === 'ready'
      ? detailSnapshot.turnOrder.flatMap((id) => {
          const turn = detailSnapshot.turnsById[id]
          return turn ? [turn] : []
        })
      : []
  const activePlan = turns.find((turn) => turn.status === 'inProgress')?.plan as
    | ChatPlanPresentation
    | undefined
  const userInput = detail.model.status === 'ready' ? detailSnapshot.userInput : undefined
  const finalPlan = turns.at(-1)?.plan?.final
    ? (turns.at(-1)?.plan as ChatPlanPresentation)
    : undefined
  const composerSlot: ThreadComposerSlotModel = composer.viewModel.error
    ? { kind: 'error', message: composer.viewModel.error }
    : userInput
      ? { kind: 'questionnaire', request: userInput as unknown as ChatUserInputRequest }
      : finalPlan
        ? { kind: 'final-plan', plan: finalPlan }
        : {
            kind: 'input',
            composer: composer.viewModel,
            ...(activePlan ? { plan: activePlan } : {}),
          }

  return {
    model,
    session: detail.model.status === 'ready' ? detail.model.session : undefined,
    compacting: composer.compacting,
    detail,
    composer: composer.viewModel,
    composerSlot,
    actions: {
      ...composer.actions,
      retry: detail.retry,
      answerUserInput: detail.answerUserInput,
      cancelUserInput: detail.cancelUserInput,
    },
    lockEpoch: visiblePending?.lockEpoch ?? 0,
    retryState: composer.retryState,
    inputErrors: detail.inputErrors,
  }
}
