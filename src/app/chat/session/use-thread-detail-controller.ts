import * as React from 'react'

import type { CodexHistoryEvent, CodexNotification } from '@/app/chat/native/codex-thread'
import {
  toThreadPresentationSnapshot,
  useThreadSessionRegistry,
  useThreadSessionSnapshot,
  type ThreadSession,
} from './thread-session-store'
import {
  waitForThreadAvailability,
  type ThreadClient,
  type ThreadEvent,
  type ThreadSnapshot,
} from '@/lib/bridge/thread-client'
import { transcriptDebug } from '@/app/chat/transcript/transcript-debug'

export type ThreadDetailModel =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      session: ThreadSession
      thread: ReturnType<typeof toThreadPresentationSnapshot>
    }

export function useThreadDetailController(
  client: ThreadClient,
  projectId: string | null | undefined,
  threadId: string | null,
  onUnavailable?: () => void,
  onThreadLifecycle?: (method: 'thread/archived' | 'thread/deleted' | 'thread/closed') => void,
) {
  const registry = useThreadSessionRegistry()
  const [retryKey, setRetryKey] = React.useState(0)
  const requestKey =
    projectId !== undefined && threadId ? `${projectId ?? '<root>'}\0${threadId}` : null
  const session = requestKey && threadId ? registry.get(projectId ?? null, threadId) : null
  const snapshot = useThreadSessionSnapshot(session)

  React.useEffect(() => {
    if (projectId === undefined || !threadId || !requestKey || !session) return
    const controller = new AbortController()
    registry.retain(projectId ?? null, threadId)
    let active = true
    let lastEventId = 0
    let snapshotEventCursor = 0
    let sparseTurnIds = new Set<string>()
    let unsubscribe: () => void = () => undefined
    let recoveryTimer: number | null = null
    let recoveryAttempts = 0
    let recovering = false
    const lifecycleMethods = new Set(['thread/archived', 'thread/deleted', 'thread/closed'])
    const lifecycleEventIds = new Set<number>()
    const receive = (event: ThreadEvent) => {
      if (!active) return
      const parsed = parseNotification(event.message)
      if (
        event.id <= snapshotEventCursor &&
        sparseTurnIds.size > 0 &&
        (!parsed.ok || !notificationReferencesTurn(parsed.value, sparseTurnIds))
      )
        return
      if (event.id <= lastEventId) return
      lastEventId = event.id
      transcriptDebug({
        phase: 'event',
        threadId,
        eventId: event.id,
        method: parsed.ok ? parsed.value.method : undefined,
      })
      if (!parsed.ok) {
        session.applyEvent(
          { method: 'webcodex/protocol-error', params: { code: parsed.error } },
          event.id,
        )
        return
      }
      if (lifecycleMethods.has(parsed.value.method)) {
        if (lifecycleEventIds.has(event.id)) return
        lifecycleEventIds.add(event.id)
        onThreadLifecycle?.(
          parsed.value.method as 'thread/archived' | 'thread/deleted' | 'thread/closed',
        )
        return
      }
      session.applyEvent(parsed.value, event.id)
      transcriptDebug({ phase: 'turn', threadId, eventId: event.id, method: parsed.value.method })
    }
    const subscribe = (afterId: number) => {
      unsubscribe()
      unsubscribe = client.subscribe(threadId, afterId, receive, scheduleRecovery)
    }
    const hydrateAndSubscribe = (response: ThreadSnapshot) => {
      if (!active) return
      const historyEvents: CodexHistoryEvent[] = (response.historyEvents ?? []).map((event) => ({
        id: event.id,
        message: { ...event.message, params: event.message.params ?? {} },
      }))
      const hydration = session.hydrate(response.thread, response.eventCursor, historyEvents)
      snapshotEventCursor = response.eventCursor
      sparseTurnIds = hydration.sparseTurnIds
      lastEventId = hydration.replayAfterId
      subscribe(hydration.replayAfterId)
    }
    const reconcileTimer = window.setInterval(() => {
      if (!active || !session.state.isBusy || recovering) return
      void client
        .readThreadStatus(projectId, threadId, controller.signal)
        .then((status) => {
          if (!active || status.eventCursor <= lastEventId) return
          return client.readThread(projectId, threadId, controller.signal).then(hydrateAndSubscribe)
        })
        .catch(() => undefined)
    }, 5_000)
    const recover = async () => {
      if (!active || recovering) return
      recovering = true
      try {
        const status = await client.readThreadStatus(projectId, threadId, controller.signal)
        if (!active) return
        if (status.eventCursor > lastEventId) {
          hydrateAndSubscribe(await client.readThread(projectId, threadId, controller.signal))
        } else {
          subscribe(lastEventId)
        }
        recoveryAttempts = 0
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (isCodexUnavailable(error)) onUnavailable?.()
        if (recoveryAttempts >= 5) {
          session.setError(
            error instanceof Error ? error.message : 'Could not restore this thread. Try again.',
          )
          return
        }
        recoveryAttempts += 1
        const delay = Math.min(8_000, 2 ** (recoveryAttempts - 1) * 1_000)
        recoveryTimer = window.setTimeout(() => {
          recoveryTimer = null
          void recover()
        }, delay)
      } finally {
        recovering = false
      }
    }
    function scheduleRecovery() {
      onUnavailable?.()
      if (!active || recoveryTimer !== null || recovering) return
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null
        void recover()
      }, 1_000)
    }
    void waitForThreadAvailability(
      (signal) => client.readThread(projectId, threadId, signal),
      controller.signal,
    )
      .then(hydrateAndSubscribe)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (isCodexUnavailable(error)) onUnavailable?.()
        session.setError(
          error instanceof Error ? error.message : 'Could not load this thread. Try again.',
        )
      })
    return () => {
      active = false
      controller.abort()
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
      window.clearInterval(reconcileTimer)
      unsubscribe()
      registry.release(projectId ?? null, threadId)
    }
  }, [
    onThreadLifecycle,
    onUnavailable,
    client,
    projectId,
    registry,
    requestKey,
    retryKey,
    session,
    threadId,
  ])

  const model: ThreadDetailModel =
    !requestKey || !session
      ? { status: 'idle' }
      : snapshot.status === 'ready'
        ? { status: 'ready', session, thread: toThreadPresentationSnapshot(snapshot) }
        : snapshot.status === 'error'
          ? { status: 'error', message: snapshot.error ?? 'Could not load this thread. Try again.' }
          : { status: 'loading' }
  const retry = React.useCallback(() => setRetryKey((value) => value + 1), [])
  const answer = React.useCallback(
    async (answers: Record<string, { answers: string[] }>) => {
      const request = snapshot.userInput
      if (!threadId || !request) return
      await client.answerUserInput(threadId, request.requestId, answers)
    },
    [client, snapshot.userInput, threadId],
  )
  const cancelUserInput = React.useCallback(async () => {
    const request = snapshot.userInput
    if (!threadId || !request || !session) return
    await client.cancelTurn(threadId, request.turnId)
    session.interruptUserInput()
  }, [client, session, snapshot.userInput, threadId])
  const followTurn = React.useCallback(() => {
    setRetryKey((value) => value + 1)
  }, [])
  return {
    model,
    retry,
    followTurn,
    answerUserInput: answer,
    cancelUserInput,
    inputErrors: snapshot.inputErrors,
  }
}

function parseNotification(
  value: unknown,
): { ok: true; value: CodexNotification } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'SSE event must be an object.' }
  if (typeof value.method !== 'string' || !value.method || !isRecord(value.params))
    return { ok: false, error: 'SSE event must contain method and params.' }
  return {
    ok: true,
    value: {
      method: value.method,
      params: value.params,
      ...(typeof value.id === 'number' || typeof value.id === 'string' ? { id: value.id } : {}),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCodexUnavailable(error: unknown) {
  const candidate = error as { code?: unknown; status?: unknown }
  return candidate?.code === 'CODEX_UNAVAILABLE' || candidate?.status === 502
}

function notificationReferencesTurn(notification: CodexNotification, turnIds: Set<string>) {
  const directTurnId =
    typeof notification.params.turnId === 'string' ? notification.params.turnId : undefined
  if (directTurnId && turnIds.has(directTurnId)) return true
  const turn = notification.params.turn
  return isRecord(turn) && typeof turn.id === 'string' && turnIds.has(turn.id)
}
