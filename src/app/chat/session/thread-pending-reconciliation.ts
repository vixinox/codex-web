import type {
  ChatPendingTurn,
  ChatThreadPresentation,
  ChatTurnPresentation,
} from '@/app/chat/model/types'
import { parseMarkdownBlocks } from '@/app/chat/composer/chat-input-markdown'

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
  const matchingUserTurnIndex = findMatchingUserTurn(thread, pending)
  const inProgressIndexes = thread.turns.flatMap((turn, index) =>
    turn.status === 'inProgress' ? [index] : [],
  )
  const nativeTurnIndex =
    exactTurnIndex >= 0
      ? exactTurnIndex
      : matchingUserTurnIndex >= 0
        ? matchingUserTurnIndex
        : inProgressIndexes.length === 1
          ? inProgressIndexes[0]
          : -1
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
        startedAt: turn.status === 'inProgress' ? pending.startedAt : turn.startedAt,
        blocks,
      }
    }),
  }
}

function findMatchingUserTurn(thread: ChatThreadPresentation, pending: ChatPendingTurn) {
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const user = thread.turns[index]?.blocks.find((block) => block.type === 'user')
    if (!user || user.type !== 'user') continue
    const text = user.content
      .map((part) => (part.type === 'text' || part.type === 'codeSnippet' ? part.text : ''))
      .join('')
    const pendingText = parseMarkdownBlocks(pending.text)
      .flatMap((part) => (part.kind === 'skill' ? [] : [part.text]))
      .join('')
    if (text === pendingText || text === pending.text) return index
  }
  return -1
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
