import type {
  ChatPendingTurn,
  ChatThreadPresentation,
  ChatTurnPresentation,
} from '@/app/chat/model/types'

export function pendingMatchesTarget(
  pending: ChatPendingTurn,
  projectId: string | null,
  threadId: string | null,
) {
  return (
    pending.projectId === projectId && (threadId === null || pending.nativeThreadId === threadId)
  )
}

export function reconcilePendingThread(
  thread: ChatThreadPresentation,
  pending: ChatPendingTurn,
): ChatThreadPresentation {
  const exactTurnIndex = pending.nativeTurnId
    ? thread.turns.findIndex((turn) => turn.id === pending.nativeTurnId)
    : -1
  const nativeTurnIndex = exactTurnIndex
  if (nativeTurnIndex < 0)
    return {
      ...thread,
      turns: [...thread.turns, optimisticTurn(pending)],
      isBusy: true,
    }

  return {
    ...thread,
    turns: thread.turns.map((turn, index) => {
      if (index !== nativeTurnIndex) return turn
      const hasNativeUser = turn.blocks.some((block) => block.type === 'user')
      const blocks = hasNativeUser
        ? turn.blocks.map((block) =>
            block.type === 'user' &&
            pending.content?.some((part) => part.type === 'codeSnippet') &&
            !block.content.some((part) => part.type === 'codeSnippet')
              ? {
                  ...block,
                  content: [
                    ...pending.content.filter((part) => part.type === 'codeSnippet'),
                    ...block.content,
                  ],
                }
              : block,
          )
        : [optimisticUserBlock(pending), ...turn.blocks]
      return {
        ...turn,
        presentationId: pending.clientTurnId,
        startedAt:
          turn.status === 'inProgress' ? (turn.startedAt ?? pending.startedAt) : turn.startedAt,
        blocks,
      }
    }),
  }
}

export function optimisticThread(pending: ChatPendingTurn): ChatThreadPresentation {
  return {
    id: pending.nativeThreadId ?? pending.optimisticThreadId,
    projectId: pending.projectId,
    title: '',
    turns: [optimisticTurn(pending)],
    isBusy: true,
  }
}

function optimisticTurn(pending: ChatPendingTurn): ChatTurnPresentation {
  return {
    id: pending.clientTurnId,
    presentationId: pending.clientTurnId,
    status: 'inProgress',
    startedAt: pending.startedAt,
    blocks: [optimisticUserBlock(pending)],
  }
}

function optimisticUserBlock(pending: ChatPendingTurn) {
  return {
    id: `${pending.clientTurnId}-user`,
    type: 'user' as const,
    content: pending.content ?? [{ type: 'text' as const, text: pending.text }],
  }
}
