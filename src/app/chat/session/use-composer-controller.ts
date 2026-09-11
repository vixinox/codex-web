import * as React from 'react'

import {
  clearComposerDraft,
  clearComposerSkills,
  ensureComposerScope,
  setComposerDraft,
  updateComposerPreferences,
  useComposerScopeSnapshot,
  type ComposerPreferences,
} from '@/app/chat/composer/composer-store'
import { composerScopeForTarget } from '@/app/chat/composer/composer-scope'
import { toComposerUsageView } from '@/app/chat/composer/composer-view-model'
import {
  syncComposerPreferences,
  type ThreadComposerSelection,
} from '@/app/chat/composer/model-selection-sync'
import type { ComposerCapabilities } from '@/app/chat/composer/composer-capabilities'
import type {
  ChatEffort,
  ChatModel,
  CollaborationMode,
  ComposerActions,
  ComposerSkill,
  ComposerViewModel,
  SkillPickerViewModel,
} from '@/app/chat/model/composer-types'
import type { ChatPendingTurn, ChatTokenUsage } from '@/app/chat/model/types'
import { waitForThreadAvailability } from '@/lib/bridge/thread-client'
import type { AcceptedTurn, ComposerHost, ComposerRuntimeAdapter } from './composer-adapter'

export type { AcceptedTurn, ComposerHost, ComposerRuntimeAdapter } from './composer-adapter'

type ComposerControllerOptions = {
  userId: string
  adapter: ComposerRuntimeAdapter
  host: ComposerHost
  /** Screen-level override of the adapter capability config, e.g. New Chat. */
  capabilities?: ComposerCapabilities
  runtimeReady: boolean
  runtimeStatus?: string
  working: boolean
  tokenUsage?: ChatTokenUsage
  threadSelection?: ThreadComposerSelection
  onPendingChange?: (pending: ChatPendingTurn | null, key: string | null) => void
}

const MAX_RETRIES = 5
const FALLBACK_PREFERENCES: ComposerPreferences = {
  model: 'gpt-5.6-sol',
  effort: 'medium',
  collaborationMode: 'default',
}

/**
 * The single Composer state machine for both runtimes. Runtime differences
 * arrive through `adapter` (transport, capability config, selection storage)
 * and composition differences through `host` (navigation, refresh, feedback).
 *
 * Host callbacks are read through a ref so a host that rebuilds its callback
 * object each render does not re-run the Skill and context-window loads.
 */
export function useComposerController({
  userId,
  adapter,
  host,
  capabilities,
  runtimeReady,
  runtimeStatus,
  working,
  tokenUsage,
  threadSelection,
  onPendingChange,
}: ComposerControllerOptions) {
  const hostRef = React.useRef(host)
  React.useEffect(() => {
    hostRef.current = host
  }, [host])
  const scope = composerScopeForTarget(userId, host.target)
  const targetProjectId = host.target.projectId
  const selection = adapter.selection
  const state = ensureComposerScope(
    scope,
    selection ? selection.read(userId, host.target) : FALLBACK_PREFERENCES,
  )
  const snapshot = useComposerScopeSnapshot(scope)
  const resolvedCapabilities = capabilities ?? adapter.capabilities
  const appliedThreadSelection = React.useRef<{
    scope: string
    selection?: ThreadComposerSelection
  } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = React.useState(0)
  const [compacting, setCompacting] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [skills, setSkills] = React.useState<SkillPickerViewModel>({
    status: 'loading',
    items: [],
  })
  const [skillRetryKey, setSkillRetryKey] = React.useState(0)
  const [settledSkillRequest, setSettledSkillRequest] = React.useState<string | null>(null)
  const [contextWindow, setContextWindow] = React.useState<number | undefined>(undefined)
  const operation = React.useRef<AbortController | null>(null)
  const sequence = React.useRef(0)

  React.useEffect(() => {
    const applied = appliedThreadSelection.current
    if (
      applied?.scope === scope &&
      applied.selection?.model === threadSelection?.model &&
      applied.selection?.reasoningEffort === threadSelection?.reasoningEffort
    )
      return
    const preferences = syncComposerPreferences(
      snapshot.preferences,
      threadSelection,
      resolvedCapabilities,
      applied?.scope === scope ? applied.selection : undefined,
    )
    appliedThreadSelection.current = { scope, selection: threadSelection }
    if (
      preferences.model === snapshot.preferences.model &&
      preferences.effort === snapshot.preferences.effort
    )
      return
    updateComposerPreferences(scope, () => preferences)
    if (host.target.threadId) selection?.write(userId, host.target, preferences)
  }, [
    host.target,
    resolvedCapabilities,
    scope,
    selection,
    snapshot.preferences,
    threadSelection,
    userId,
  ])

  // Selection defaults follow the scope the user is actually looking at.
  const persistSelection = React.useCallback(
    (threadId: string | null, preferences: ComposerPreferences) => {
      if (!selection) return
      selection.write(
        userId,
        { projectId: hostRef.current.target.projectId, threadId },
        preferences,
      )
    },
    [selection, userId],
  )

  const setDraft = React.useCallback(
    (draft: string, nextSkills?: readonly ComposerSkill[]) => {
      setComposerDraft(scope, draft, nextSkills)
      setError(null)
    },
    [scope],
  )
  const setModel = React.useCallback(
    (model: ChatModel) => {
      updateComposerPreferences(scope, (current) => ({ ...current, model }))
      persistSelection(hostRef.current.target.threadId, { ...state.preferences, model })
    },
    [persistSelection, scope, state],
  )
  const setEffort = React.useCallback(
    (effort: ChatEffort) => {
      updateComposerPreferences(scope, (current) => ({ ...current, effort }))
      persistSelection(hostRef.current.target.threadId, { ...state.preferences, effort })
    },
    [persistSelection, scope, state],
  )
  const setCollaborationMode = React.useCallback(
    (collaborationMode: CollaborationMode) => {
      updateComposerPreferences(scope, (current) => ({ ...current, collaborationMode }))
      persistSelection(hostRef.current.target.threadId, {
        ...state.preferences,
        collaborationMode,
      })
    },
    [persistSelection, scope, state],
  )

  React.useEffect(() => {
    if (!runtimeReady) return
    const controller = new AbortController()
    const requestKey = `${targetProjectId ?? '<root>'}\0${skillRetryKey}`
    void adapter
      .listSkills(targetProjectId, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return undefined
        setSkills({ status: 'ready', items })
        setSettledSkillRequest(requestKey)
        return undefined
      })
      .catch((nextError: unknown) => {
        if (
          controller.signal.aborted ||
          (nextError instanceof DOMException && nextError.name === 'AbortError')
        )
          return
        if (isCodexUnavailable(nextError)) hostRef.current.onUnavailable?.()
        setSkills({
          status: 'error',
          items: [],
          message:
            adapter.messages?.skillsError ??
            (nextError instanceof Error && nextError.message
              ? nextError.message
              : 'Could not load skills right now.'),
        })
        setSettledSkillRequest(requestKey)
      })
    return () => controller.abort()
  }, [adapter, runtimeReady, skillRetryKey, targetProjectId])

  React.useEffect(
    () => adapter.subscribeToSkillChanges?.(() => setSkillRetryKey((value) => value + 1)),
    [adapter],
  )

  const readContextWindow = adapter.readContextWindow
  React.useEffect(() => {
    if (!runtimeReady || !readContextWindow) return
    const controller = new AbortController()
    void readContextWindow(controller.signal)
      .then((window) => {
        if (!controller.signal.aborted) setContextWindow(window)
        return undefined
      })
      .catch((nextError: unknown) => {
        if (
          controller.signal.aborted ||
          (nextError instanceof DOMException && nextError.name === 'AbortError')
        )
          return
        if (isCodexUnavailable(nextError)) hostRef.current.onUnavailable?.()
        setContextWindow(undefined)
      })
    return () => controller.abort()
  }, [readContextWindow, runtimeReady, runtimeStatus])

  const submit = React.useCallback(
    async (
      text: string,
      submittedSkills: readonly ComposerSkill[] = snapshot.skills,
      mode = snapshot.preferences.collaborationMode,
    ) => {
      if (!text.trim() || operation.current) return
      const target = hostRef.current.target
      const controller = new AbortController()
      operation.current = controller
      const clientTurnId = `client-turn-${++sequence.current}`
      const optimisticTurn: ChatPendingTurn = {
        clientTurnId,
        projectId: target.projectId,
        optimisticThreadId: `optimistic-thread-${sequence.current}`,
        ...(target.threadId ? { nativeThreadId: target.threadId } : {}),
        text,
        content: [
          ...submittedSkills.map((skill) => ({
            type: 'reference' as const,
            kind: 'skill' as const,
            label: skill.displayName,
          })),
          { type: 'text' as const, text },
        ],
        startedAt: Date.now(),
      }
      onPendingChange?.(
        optimisticTurn,
        target.threadId ? `${target.projectId ?? '<root>'}\0${target.threadId}` : scope,
      )
      setSubmitting(true)
      setError(null)
      setRetryAttempt(0)
      const input = {
        projectId: target.projectId,
        text,
        model: snapshot.preferences.model,
        reasoningEffort: snapshot.preferences.effort,
        collaborationMode: mode,
        skillHandles: submittedSkills.map((skill) => skill.handle),
      }
      let accepted: AcceptedTurn | undefined
      try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
          try {
            if (target.threadId) {
              const result = await adapter.threads.startTurn(
                target.threadId,
                input,
                controller.signal,
              )
              accepted = {
                projectId: target.projectId,
                threadId: target.threadId,
                turnId: result.turnId,
              }
            } else {
              accepted = await adapter.threads.createThread(input, controller.signal)
            }
            break
          } catch (nextError) {
            if (!isNetworkError(nextError) || attempt === MAX_RETRIES) throw nextError
            setRetryAttempt(attempt)
            await waitForRetry(controller.signal, 2 ** (attempt - 1) * 1000)
          }
        }
        if (!accepted) return
        const acceptedTurn = accepted
        hostRef.current.onTurnAccepted(acceptedTurn)
        if (!target.threadId)
          await waitForThreadAvailability(
            (signal) =>
              adapter.threads.readThread(acceptedTurn.projectId, acceptedTurn.threadId, signal),
            controller.signal,
          )
        const pendingTurn: ChatPendingTurn = {
          ...optimisticTurn,
          projectId: acceptedTurn.projectId,
          nativeThreadId: acceptedTurn.threadId,
          ...(adapter.acceptedTurnIdIsNative ? { nativeTurnId: acceptedTurn.turnId } : {}),
        }
        onPendingChange?.(
          pendingTurn,
          composerScopeForTarget(userId, {
            projectId: acceptedTurn.projectId,
            threadId: acceptedTurn.threadId,
          }),
        )
        clearComposerDraft(scope)
        clearComposerSkills(scope)
        updateComposerPreferences(scope, (current) => ({ ...current, collaborationMode: mode }))
        const submitted: ComposerPreferences = {
          ...snapshot.preferences,
          collaborationMode: mode,
        }
        persistSelection(target.threadId ?? acceptedTurn.threadId, submitted)
        if (target.threadId) hostRef.current.onTurnFollowed?.(acceptedTurn)
        else hostRef.current.onThreadCreated?.(acceptedTurn)
      } catch (nextError) {
        onPendingChange?.(null, null)
        if (nextError instanceof DOMException && nextError.name === 'AbortError') return
        const message =
          nextError instanceof Error
            ? nextError.message
            : (adapter.messages?.submitError ?? 'Codex could not send this message.')
        setError(message)
        hostRef.current.onError?.(message)
        if (isCodexUnavailable(nextError)) hostRef.current.onUnavailable?.()
      } finally {
        if (operation.current === controller) operation.current = null
        setSubmitting(false)
        setRetryAttempt(0)
      }
    },
    [
      adapter,
      onPendingChange,
      persistSelection,
      scope,
      snapshot.preferences,
      snapshot.skills,
      userId,
    ],
  )

  const stop = React.useCallback(async () => {
    const current = hostRef.current
    // Composition-owned cancel (e.g. the Guest lease) clears its own active Turn
    // even when cancel fails; a route-owned cancel only refreshes on success.
    if (current.cancelActiveTurn) {
      try {
        await current.cancelActiveTurn()
      } finally {
        current.onTurnCancelled?.()
      }
      return
    }
    if (!current.target.threadId || !working || !current.activeTurnId) return
    await adapter.threads.cancelTurn(current.target.threadId, current.activeTurnId)
    current.onTurnCancelled?.()
  }, [adapter, working])

  const compact = React.useCallback(async () => {
    const current = hostRef.current
    if (!current.target.threadId || compacting || working) return
    setCompacting(true)
    try {
      await adapter.threads.compactThread(current.target.threadId)
      current.onCompacted?.(current.target.threadId)
    } catch (nextError) {
      setCompacting(false)
      const message =
        adapter.messages?.compactError ??
        (nextError instanceof Error ? nextError.message : 'Codex could not compact this chat.')
      setError(message)
      current.onError?.(message)
      if (isCodexUnavailable(nextError)) current.onUnavailable?.()
    }
  }, [adapter, compacting, working])

  const actions: ComposerActions = {
    setDraft,
    setModel,
    setEffort,
    setCollaborationMode,
    retrySkills: () => setSkillRetryKey((value) => value + 1),
    submit,
    submitWithMode: (text, mode) => submit(text, snapshot.skills, mode),
    onCommand: (command) => {
      if (command === 'compact') void compact()
      else setCollaborationMode('plan')
    },
    stop,
  }
  const skillRequestKey = `${targetProjectId ?? '<root>'}\0${skillRetryKey}`
  const viewSkills: SkillPickerViewModel = !runtimeReady
    ? { status: 'ready', items: [] }
    : settledSkillRequest === skillRequestKey
      ? skills
      : { status: 'loading', items: skills.items }
  const usage = toComposerUsageView({
    thread: tokenUsage ? { tokenUsage } : null,
    contextWindow,
    runtimeReady,
  })
  const viewModel: ComposerViewModel = {
    draft: snapshot.draft,
    model: snapshot.preferences.model,
    effort: snapshot.preferences.effort,
    collaborationMode: snapshot.preferences.collaborationMode,
    submitting,
    working: working || compacting,
    error,
    ...usage,
    skills: viewSkills,
    selectedSkills: snapshot.skills,
  }
  return {
    scope,
    viewModel,
    actions,
    capabilities: resolvedCapabilities,
    retryState: retryAttempt ? { attempt: retryAttempt, maxAttempts: MAX_RETRIES } : null,
    compacting,
  }
}

function isNetworkError(error: unknown) {
  const status = (error as { status?: unknown })?.status
  return (
    typeof status === 'number' &&
    (status === 0 || status === 408 || status === 429 || status >= 500)
  )
}

function isCodexUnavailable(error: unknown) {
  const value = error as { status?: unknown; code?: unknown }
  return value?.code === 'CODEX_UNAVAILABLE' || value?.status === 502
}

function waitForRetry(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
