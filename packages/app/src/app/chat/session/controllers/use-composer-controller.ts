import { queueTransition, claimQueuedMessage } from '@/app/chat/composer/state/queued-message'
import * as React from 'react'

import {
  composerStore,
  clearComposerDraft,
  clearComposerSkills,
  DEFAULT_COMPOSER_PREFERENCES,
  ensureComposerScope,
  setComposerDraft,
  updateComposerPreferences,
  useComposerScopeSnapshot,
  type ComposerPreferences,
} from '@/app/chat/composer/state/composer-store'
import { composerScopeForTarget } from '@/app/chat/composer/state/composer-scope'
import { toComposerUsageView } from '@/app/chat/composer/model/composer-view-model'
import {
  syncComposerPreferences,
  type ThreadComposerSelection,
} from '@/app/chat/composer/state/model-selection-sync'
import { defaultComposerPreferences } from '@/app/chat/composer/model/composer-capabilities'
import { trackProductEvent } from '@/lib/connection/telemetry'
import type {
  ChatEffort,
  ChatModel,
  CollaborationMode,
  ComposerActions,
  ComposerSkill,
  ComposerViewModel,
  SkillPickerViewModel,
} from '@/app/chat/model/composer-types'
import type { ChatPendingTurn } from '@/app/chat/model/types'
import type { CodeSnippetAttachment } from '@/app/chat/composer/model/draft-model'
import type { ComposerSession, ComposerSessionOptions } from '../interface'
import type { AcceptedTurn } from '../adapters/composer-adapter'
import { presentAppError } from '@/lib/errors/presentation'

export type {
  AcceptedTurn,
  ComposerHost,
  ComposerRuntimeAdapter,
} from '../adapters/composer-adapter'

export type ComposerControllerOptions = ComposerSessionOptions

const MAX_RETRIES = 5

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
  onThreadCreationStart,
  onThreadCreationFailed,
  onThreadCreationResolved,
}: ComposerControllerOptions): ComposerSession {
  const hostRef = React.useRef(host)
  React.useEffect(() => {
    hostRef.current = host
  }, [host])
  const scope = composerScopeForTarget(userId, host.target)
  const targetProjectId = host.target.projectId
  const selection = adapter.selection
  const resolvedCapabilities = capabilities ?? adapter.capabilities
  const storedSelection = selection?.read(userId, host.target)
  const initialSelection = storedSelection ?? defaultComposerPreferences(resolvedCapabilities)
  ensureComposerScope(
    scope,
    initialSelection.model ? initialSelection : DEFAULT_COMPOSER_PREFERENCES,
  )
  const snapshot = useComposerScopeSnapshot(scope)
  const appliedThreadSelections = React.useRef(
    new Map<string, ThreadComposerSelection | undefined>(),
  )
  const createdThreadScopes = React.useRef(new Set<string>())
  const [error, setError] = React.useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = React.useState(0)
  // local: optimistic compact intent, not an App Server turn field.
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
  const targetGeneration = React.useRef(0)
  const targetKey = `${host.target.projectId ?? '<root>'}\0${host.target.threadId ?? '<new>'}`
  const previousTargetKey = React.useRef(targetKey)
  // Invalidate old async callbacks during the render that observes a route
  // change. An effect runs too late for requests that settle immediately.
  if (previousTargetKey.current !== targetKey) {
    previousTargetKey.current = targetKey
    targetGeneration.current += 1
    // Keep the old request running, but let the new route submit independently.
    operation.current = null
  }
  React.useEffect(() => {
    setSubmitting(false)
    setError(null)
  }, [targetKey])

  React.useEffect(() => {
    const hasApplied = appliedThreadSelections.current.has(scope)
    const applied = appliedThreadSelections.current.get(scope)
    const createdThread = createdThreadScopes.current.has(scope)
    if (createdThread && !threadSelection) return
    if (createdThread) {
      createdThreadScopes.current.delete(scope)
      appliedThreadSelections.current.set(scope, threadSelection)
      return
    }
    if (
      hasApplied &&
      applied?.model === threadSelection?.model &&
      applied?.reasoningEffort === threadSelection?.reasoningEffort
    )
      return
    const preferences = syncComposerPreferences(
      snapshot.preferences,
      threadSelection,
      resolvedCapabilities,
      hasApplied ? applied : undefined,
    )
    appliedThreadSelections.current.set(scope, threadSelection)
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

  React.useEffect(() => {
    const preferences = syncComposerPreferences(
      snapshot.preferences,
      undefined,
      resolvedCapabilities,
    )
    if (
      preferences.model === snapshot.preferences.model &&
      preferences.effort === snapshot.preferences.effort
    )
      return
    updateComposerPreferences(scope, () => preferences)
    selection?.write(userId, host.target, preferences)
  }, [resolvedCapabilities, scope, selection, snapshot.preferences, userId, host.target])

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

  const updatePreferences = React.useCallback(
    (update: (preferences: ComposerPreferences) => ComposerPreferences) => {
      const next = updateComposerPreferences(scope, update)
      persistSelection(hostRef.current.target.threadId, next)
    },
    [persistSelection, scope],
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
      updatePreferences((current) => ({ ...current, model }))
    },
    [updatePreferences],
  )
  const setEffort = React.useCallback(
    (effort: ChatEffort) => {
      updatePreferences((current) => ({ ...current, effort }))
    },
    [updatePreferences],
  )
  const setCollaborationMode = React.useCallback(
    (collaborationMode: CollaborationMode) => {
      updatePreferences((current) => ({ ...current, collaborationMode }))
    },
    [updatePreferences],
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
            presentAppError(nextError, 'Could not load skills right now.'),
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
      attachments: readonly Pick<
        CodeSnippetAttachment,
        'text' | 'title' | 'lineCount' | 'characterCount'
      >[] = [],
    ) => {
      if (
        !text.trim() ||
        operation.current ||
        composerStore.scopes[scope]?.queued?.status === 'sending'
      )
        return
      const currentScope = ensureComposerScope(scope)
      if (currentScope.queued) {
        setError('A message is already queued. Edit or delete it first.')
        return
      }
      const target = hostRef.current.target
      if (target.threadId && working) {
        const turnId = hostRef.current.activeTurnId
        if (!turnId) {
          setError('Wait for the current turn to finish starting.')
          return
        }
        currentScope.queued = {
          id: crypto.randomUUID(),
          turnId,
          draft: currentScope.draft,
          text,
          skills: submittedSkills.map((skill) => ({ ...skill })),
          preferences: { ...currentScope.preferences, collaborationMode: mode },
          status: 'queued',
        }
        clearComposerDraft(scope)
        clearComposerSkills(scope)
        setError(null)
        return
      }
      const submittedDraft = currentScope.draft
      const generation = targetGeneration.current
      const controller = new AbortController()
      operation.current = controller
      const clientTurnId = `client-turn-${++sequence.current}`
      const placeholderId = !target.threadId
        ? onThreadCreationStart?.(target.projectId, text)
        : undefined
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
          ...attachments.map((attachment) => ({ type: 'codeSnippet' as const, ...attachment })),
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
        skills: submittedSkills.map(({ name, path }) => ({ name, path })),
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
        trackProductEvent('turn_accepted')
        const acceptedTurn = accepted
        if (placeholderId)
          onThreadCreationResolved?.(placeholderId, acceptedTurn.projectId, acceptedTurn.threadId)
        if (generation !== targetGeneration.current) return
        hostRef.current.onTurnAccepted(acceptedTurn)
        // local: optimistic turn shaped like native presentation until reconciliation.
        const pendingTurn: ChatPendingTurn = {
          ...optimisticTurn,
          accepted: true,
          projectId: acceptedTurn.projectId,
          nativeThreadId: acceptedTurn.threadId,
          nativeTurnId: acceptedTurn.turnId,
        }
        if (generation !== targetGeneration.current) return
        onPendingChange?.(
          pendingTurn,
          composerScopeForTarget(userId, {
            projectId: acceptedTurn.projectId,
            threadId: acceptedTurn.threadId,
          }),
        )
        if (ensureComposerScope(scope).draft === submittedDraft) {
          clearComposerDraft(scope)
          clearComposerSkills(scope)
        }
        updateComposerPreferences(scope, (current) => ({ ...current, collaborationMode: mode }))
        const submitted: ComposerPreferences = {
          ...snapshot.preferences,
          collaborationMode: mode,
        }
        persistSelection(target.threadId ?? acceptedTurn.threadId, submitted)
        if (!target.threadId) {
          const createdScope = composerScopeForTarget(userId, {
            projectId: acceptedTurn.projectId,
            threadId: acceptedTurn.threadId,
          })
          updateComposerPreferences(createdScope, () => submitted)
          createdThreadScopes.current.add(createdScope)
        }
        // Establish the native Thread URL as soon as creation is accepted so
        // Settings/back navigation never loses the source while availability
        // polling is still in progress. Keep the local preference/pending
        // updates above synchronous with the accepted response.
        if (!target.threadId) hostRef.current.onThreadCreated?.(acceptedTurn)
        if (!target.threadId)
          await adapter.waitForThread?.(
            acceptedTurn.projectId,
            acceptedTurn.threadId,
            controller.signal,
          )
        if (target.threadId) hostRef.current.onTurnFollowed?.(acceptedTurn)
      } catch (nextError) {
        if (generation === targetGeneration.current) onPendingChange?.(null, null)
        if (nextError instanceof DOMException && nextError.name === 'AbortError') return
        const message = presentAppError(
          nextError,
          adapter.messages?.submitError ?? 'Codex could not send this message.',
        )
        if (generation === targetGeneration.current) {
          setError(message)
          if (placeholderId) onThreadCreationFailed?.(placeholderId, message)
          hostRef.current.onError?.(message)
          if (isCodexUnavailable(nextError)) hostRef.current.onUnavailable?.()
        }
      } finally {
        if (operation.current === controller) operation.current = null
        if (generation === targetGeneration.current) {
          setSubmitting(false)
          setRetryAttempt(0)
        }
      }
    },
    [
      adapter,
      onPendingChange,
      persistSelection,
      scope,
      snapshot.preferences,
      snapshot.skills,
      working,
      userId,
    ],
  )

  const sendQueued = React.useCallback(
    async (steer: boolean) => {
      const state = composerStore.scopes[scope]
      const queued = state?.queued
      const current = hostRef.current
      const context = current.queueContext
      const threadId = current.target.threadId
      if (
        !queued ||
        queued.status === 'sending' ||
        !threadId ||
        !context?.healthy ||
        context.blocked ||
        operation.current
      )
        return
      if (
        steer &&
        (queued.status === 'paused' ||
          current.activeTurnId !== queued.turnId ||
          context.nonSteerable ||
          !adapter.threads.steerTurn)
      )
        return
      if (
        !steer &&
        (queued.status !== 'queued' ||
          working ||
          context.turns.find((turn) => turn.id === queued.turnId)?.status !== 'completed')
      )
        return
      const generation = targetGeneration.current
      // Claim synchronously before awaiting: effects and button actions share this lock.
      if (!claimQueuedMessage(queued)) return
      const controller = new AbortController()
      operation.current = controller
      const input = {
        projectId: current.target.projectId,
        text: queued.text,
        model: queued.preferences.model,
        reasoningEffort: queued.preferences.effort,
        collaborationMode: queued.preferences.collaborationMode,
        skills: queued.skills.map(({ name, path }) => ({ name, path })),
      }
      try {
        const result = steer
          ? await adapter.threads.steerTurn!(threadId, queued.turnId, input)
          : await adapter.threads.startTurn(threadId, input, controller.signal)
        if (!result?.turnId || (steer && result.turnId !== queued.turnId))
          throw new Error('Codex returned an invalid turn response.')
        if (state.queued?.id === queued.id) delete state.queued
        if (generation !== targetGeneration.current) return
        if (!steer)
          current.onTurnAccepted({
            projectId: current.target.projectId,
            threadId,
            turnId: result.turnId,
          })
        current.onTurnFollowed?.({
          projectId: current.target.projectId,
          threadId,
          turnId: result.turnId,
        })
      } catch (nextError) {
        if (state.queued?.id !== queued.id) return
        queued.status = 'paused'
        const code = (nextError as { code?: unknown } | null)?.code
        const rejected =
          code === 'owner.turn.invalid-request' ||
          code === 'owner.auth.unauthorized' ||
          code === 'owner.thread.not-found'
        queued.error =
          presentAppError(nextError, 'Could not send the queued message.') +
          (rejected
            ? ' Queue paused. Edit to resend.'
            : ' It may have been sent. Check the conversation before editing and resending.')
      } finally {
        if (operation.current === controller) operation.current = null
      }
    },
    [adapter, scope, working],
  )

  React.useEffect(() => {
    const state = composerStore.scopes[scope]
    const queued = state?.queued
    if (!queued || queued.status !== 'queued') return
    const context = host.queueContext
    if (!context?.healthy) return
    const transition = queueTransition(queued, context, working)
    if (transition === 'pause') {
      queued.status = 'paused'
      queued.error = 'Queue paused because the turn failed or stopped. Edit to resend.'
    } else if (transition === 'send') {
      void sendQueued(false)
    }
  }, [host.queueContext, scope, snapshot.queued, working, sendQueued])

  const stop = React.useCallback(async () => {
    const current = hostRef.current
    const queued = composerStore.scopes[scope]?.queued
    if (queued?.status === 'queued') {
      queued.status = 'paused'
      queued.error = 'Queue paused because Stop was requested. Edit to resend.'
    }
    // Composition-owned cancel clears its own active Turn
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
  }, [adapter, working, scope])

  const compact = React.useCallback(async () => {
    const current = hostRef.current
    if (!current.target.threadId || compacting || working) return
    setCompacting(true)
    try {
      await adapter.threads.compactThread(current.target.threadId)
      setCompacting(false)
    } catch (nextError) {
      setCompacting(false)
      const message =
        adapter.messages?.compactError ??
        presentAppError(nextError, 'Codex could not compact this chat.')
      setError(message)
      current.onError?.(message)
      if (isCodexUnavailable(nextError)) current.onUnavailable?.()
    }
  }, [adapter, compacting, working])

  const actions: ComposerActions = {
    steerQueued: () => sendQueued(true),
    deleteQueued: () => {
      const state = ensureComposerScope(scope)
      if (state.queued?.status !== 'sending') delete state.queued
    },
    editQueued: () => {
      const state = ensureComposerScope(scope)
      if (!state.queued || state.queued.status === 'sending' || state.draft.trim()) return
      const queued = state.queued
      delete state.queued
      setComposerDraft(scope, queued.draft, queued.skills)
      updateComposerPreferences(scope, () => ({ ...queued.preferences }))
      setError(null)
    },
    setDraft,
    setModel,
    setEffort,
    setCollaborationMode,
    retrySkills: () => setSkillRetryKey((value) => value + 1),
    submit: (text, skills, attachments) =>
      submit(text, skills, snapshot.preferences.collaborationMode, attachments),
    submitWithMode: (text, mode) => submit(text, snapshot.skills, mode),
    onCommand: (command) => {
      if (command === 'compact') void compact()
      else setCollaborationMode('plan')
    },
    stop: async () => {
      try {
        await stop()
      } catch (nextError) {
        setError(presentAppError(nextError, 'Could not stop this turn.'))
      }
    },
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
    queue: snapshot.queued
      ? {
          text: snapshot.queued.text,
          status: snapshot.queued.status,
          error: snapshot.queued.error,
          canSteer:
            snapshot.queued.status === 'queued' &&
            Boolean(
              host.queueContext?.healthy &&
              !host.queueContext.blocked &&
              !host.queueContext.nonSteerable &&
              host.activeTurnId === snapshot.queued.turnId &&
              adapter.threads.steerTurn,
            ),
        }
      : undefined,
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
  return (
    value?.code === 'owner.runtime.unavailable' ||
    value?.code === 'owner.runtime.start-required' ||
    value?.status === 409 ||
    value?.status === 502
  )
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
