import * as React from 'react'
import type { ConversationId } from '@codex-web/conversation'
import { ownerConversationClient } from '@/app/chat/domain/owner-conversation-client'
import type { ConversationClient } from '@/app/chat/domain/conversation-client'
import type { ThreadClient } from '@/lib/bridge/interfaces/thread'
import { presentAppError } from '@/lib/errors/presentation'
import type { ChatSession, ChatSessionModel, ThreadLifecycleHandler } from '../interface'
import {
  toThreadPresentationSnapshot,
  useThreadSessionRegistry,
  useThreadSessionSnapshot,
} from '../state/thread-session-store'

export type { ChatSession, ChatSessionModel, ThreadLifecycleHandler } from '../interface'
export type ThreadDetailModel = ChatSessionModel

export function useThreadDetailController(
  client: Pick<ThreadClient, 'answerUserInput' | 'cancelTurn'>,
  projectId: string | null | undefined,
  threadId: string | null,
  onUnavailable?: () => void,
  onThreadLifecycle?: ThreadLifecycleHandler,
  conversationClient: Pick<ConversationClient, 'watch'> = ownerConversationClient,
): ChatSession {
  const registry = useThreadSessionRegistry()
  const [retryKey, setRetryKey] = React.useState(0)
  const [streamFailure, setStreamFailure] = React.useState<{ key: string; message: string } | null>(
    null,
  )
  const session = projectId !== undefined && threadId ? registry.get(projectId, threadId) : null
  const snapshot = useThreadSessionSnapshot(session)
  const retry = React.useCallback(() => setRetryKey((value) => value + 1), [])

  React.useEffect(() => {
    if (projectId === undefined || !threadId || !session) return
    const controller = new AbortController()
    registry.retain(projectId, threadId)
    session.beginLoad()
    let stopped = false
    setStreamFailure(null)
    const transportError = (error: unknown) => {
      if (controller.signal.aborted || stopped) return
      stopped = true
      if (isCodexUnavailable(error)) onUnavailable?.()
      const message = presentAppError(error, 'Could not load this thread. Try again.')
      if (session.state.status === 'ready') setStreamFailure({ key: session.key, message })
      else session.setError(message)
    }
    void conversationClient
      .watch(
        { projectId, conversationId: threadId as ConversationId },
        {
          replaceSnapshot(value) {
            if (!controller.signal.aborted) session.replaceConversation(value)
          },
          applyChange(change) {
            if (controller.signal.aborted) return
            session.applyConversationChange(change)
            if (change.type === 'conversation.updated') {
              if (change.status === 'archived') onThreadLifecycle?.('thread/archived')
              if (change.status === 'deleted') onThreadLifecycle?.('thread/deleted')
            }
          },
          transportError,
        },
        controller.signal,
      )
      .catch(transportError)
    const reconnect = () => {
      if (stopped) retry()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reconnect()
    }
    window.addEventListener('online', reconnect)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller.abort()
      window.removeEventListener('online', reconnect)
      document.removeEventListener('visibilitychange', onVisibility)
      registry.release(projectId, threadId)
    }
  }, [
    conversationClient,
    onThreadLifecycle,
    onUnavailable,
    projectId,
    registry,
    retry,
    retryKey,
    session,
    threadId,
  ])

  const model: ChatSessionModel = !session
    ? { status: 'idle' }
    : snapshot.status === 'ready'
      ? { status: 'ready', session, thread: toThreadPresentationSnapshot(snapshot) }
      : snapshot.status === 'error'
        ? { status: 'error', message: snapshot.error ?? 'Could not load this thread. Try again.' }
        : { status: 'loading' }
  const answerUserInput = React.useCallback(
    async (answers: Record<string, { answers: string[] }>) => {
      const request = snapshot.userInput
      if (threadId && request) await client.answerUserInput(threadId, request.requestId, answers)
    },
    [client, snapshot.userInput, threadId],
  )
  const cancelUserInput = React.useCallback(async () => {
    const request = snapshot.userInput
    if (threadId && request) await client.cancelTurn(threadId, request.turnId)
  }, [client, snapshot.userInput, threadId])
  return {
    model,
    retry,
    followTurn: retry,
    answerUserInput,
    cancelUserInput,
    inputErrors: snapshot.inputErrors,
    eventError: streamFailure && streamFailure.key === session?.key ? streamFailure.message : null,
  }
}

function isCodexUnavailable(error: unknown) {
  const candidate = error as { code?: unknown; status?: unknown }
  return (
    candidate?.code === 'owner.runtime.unavailable' ||
    candidate?.code === 'owner.runtime.start-required' ||
    candidate?.status === 409 ||
    candidate?.status === 502
  )
}
