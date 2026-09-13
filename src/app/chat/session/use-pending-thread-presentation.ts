import * as React from 'react'

import { composerScopeForTarget } from '@/app/chat/composer/composer-scope'
import type { ChatPendingTurn, ChatThreadPresentation } from '@/app/chat/model/types'
import type { ComposerSelectionTarget } from './composer-adapter'
import {
  optimisticThread,
  pendingMatchesTarget,
  reconcilePendingThread,
} from './thread-pending-reconciliation'

export function usePendingThreadPresentation({
  userId,
  target,
  thread,
}: {
  userId: string
  target: ComposerSelectionTarget
  thread?: ChatThreadPresentation
}) {
  const key = composerScopeForTarget(userId, target)
  const [pending, setPending] = React.useState<ChatPendingTurn | null>(null)
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const pendingOriginRef = React.useRef<ComposerSelectionTarget | null>(null)
  // local: scroll-lock epoch used to coordinate optimistic turns.
  const [lockEpoch, setLockEpoch] = React.useState(0)
  const isSameScope = pendingKey === key
  const isCurrentNativeThread = Boolean(
    pending?.nativeThreadId && pending.nativeThreadId === target.threadId,
  )
  const isNewChatCreationTransition = Boolean(
    pending?.nativeThreadId &&
    target.threadId === null &&
    pendingOriginRef.current?.threadId === null &&
    pendingOriginRef.current?.projectId === target.projectId &&
    pending.projectId === target.projectId,
  )
  const displayPending =
    pending !== null &&
    pendingMatchesTarget(pending, target.projectId, target.threadId) &&
    (isSameScope || isCurrentNativeThread || isNewChatCreationTransition)
      ? pending
      : null
  const mergedThread =
    thread && displayPending && displayPending.nativeThreadId === thread.id
      ? reconcilePendingThread(thread, displayPending)
      : thread
  const reconciledPendingTurn = displayPending
    ? mergedThread?.turns.find((turn) => turn.presentationId === displayPending.clientTurnId)
    : undefined
  const pendingSettled = Boolean(
    reconciledPendingTurn && reconciledPendingTurn.status !== 'inProgress',
  )
  const workingTurn = mergedThread?.turns.find((turn) => turn.status === 'inProgress')

  React.useEffect(() => {
    if (!pendingSettled) return
    setPending(null)
    setPendingKey(null)
  }, [pendingSettled])

  const onPendingChange = React.useCallback(
    (nextPending: ChatPendingTurn | null, nextKey: string | null) => {
      pendingOriginRef.current = nextPending ? target : null
      setPending(nextPending)
      setPendingKey(nextKey)
      if (nextPending) setLockEpoch((epoch) => epoch + 1)
    },
    [target],
  )

  return {
    pending: pendingSettled ? null : displayPending,
    optimisticThread:
      pendingSettled || !displayPending ? undefined : optimisticThread(displayPending),
    thread: mergedThread,
    working:
      Boolean(!pendingSettled && displayPending) || Boolean(mergedThread?.isBusy || workingTurn),
    activeNativeTurnId: workingTurn?.id,
    lockEpoch,
    onPendingChange,
  }
}
