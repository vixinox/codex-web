import * as React from 'react'

import {
  fetchCodexStatus,
  restartCodex,
  startCodex,
  type CodexStatus,
} from '@/lib/bridge/http/codex'

export type WorkspaceRuntimeModel =
  | { status: 'started'; codex: CodexStatus }
  | {
      status: 'starting'
      activeCredentialId: string | null
      currentCredentialId: string | null
    }
  | { status: 'stopped'; currentCredentialId: string | null }
  | { status: 'error'; message: string; currentCredentialId: string | null }

export type CodexRuntimeErrorEvent = { id: number; message: string }

export type CodexRuntimeController = {
  model: WorkspaceRuntimeModel
  bootstrapping: boolean
  errorEvent: CodexRuntimeErrorEvent | null
  start: () => Promise<boolean>
  restart: (credentialId: string) => Promise<boolean>
  refresh: () => Promise<void>
  reportUnavailable: () => void
}

const STATUS_POLL_MS = 1000

export function useCodexRuntimeController(): CodexRuntimeController {
  const [model, setModel] = React.useState<WorkspaceRuntimeModel>({
    status: 'starting',
    activeCredentialId: null,
    currentCredentialId: null,
  })
  const [bootstrapping, setBootstrapping] = React.useState(true)
  const [errorEvent, setErrorEvent] = React.useState<CodexRuntimeErrorEvent | null>(null)
  const modelRef = React.useRef(model)
  const errorIdRef = React.useRef(0)
  const lifecycleRequestRef = React.useRef<Promise<CodexStatus> | null>(null)
  const bootstrapStartedRef = React.useRef(false)

  const updateModel = React.useCallback((next: WorkspaceRuntimeModel) => {
    modelRef.current = next
    setModel(next)
  }, [])

  const emitError = React.useCallback((message: string) => {
    errorIdRef.current += 1
    setErrorEvent({ id: errorIdRef.current, message })
  }, [])

  const waitForTerminalStatus = React.useCallback(async (signal?: AbortSignal) => {
    let status = await fetchCodexStatus(signal)
    while (status.status === 'starting' || status.status === 'restarting') {
      await waitForPoll(signal)
      status = await fetchCodexStatus(signal)
    }
    return status
  }, [])

  const applyTerminalStatus = React.useCallback(
    (status: CodexStatus, failureMode: 'stopped' | 'error') => {
      if (status.status === 'ready') {
        updateModel({ status: 'started', codex: status })
        return true
      }
      if (status.status === 'failed') {
        const message = status.error ?? 'Codex could not start.'
        emitError(message)
        updateModel(
          failureMode === 'stopped'
            ? { status: 'stopped', currentCredentialId: status.currentCredentialId }
            : { status: 'error', message, currentCredentialId: status.currentCredentialId },
        )
        return false
      }
      updateModel({ status: 'stopped', currentCredentialId: status.currentCredentialId })
      return false
    },
    [emitError, updateModel],
  )

  const runLifecycle = React.useCallback(
    async (
      request: () => Promise<CodexStatus>,
      failureMode: 'stopped' | 'error',
      credentialId: string | null,
    ) => {
      if (lifecycleRequestRef.current)
        return lifecycleRequestRef.current.then(
          (status) => status.status === 'ready',
          () => false,
        )
      const currentCredentialId =
        credentialId ??
        (modelRef.current.status === 'started'
          ? modelRef.current.codex.currentCredentialId
          : modelRef.current.currentCredentialId)
      updateModel({
        status: 'starting',
        activeCredentialId: credentialId,
        currentCredentialId,
      })
      const lifecycleRequest = request()
      lifecycleRequestRef.current = lifecycleRequest
      void lifecycleRequest.then(
        () => {
          if (lifecycleRequestRef.current === lifecycleRequest) lifecycleRequestRef.current = null
          return undefined
        },
        () => {
          if (lifecycleRequestRef.current === lifecycleRequest) lifecycleRequestRef.current = null
          return undefined
        },
      )
      try {
        const status = await lifecycleRequest
        return applyTerminalStatus(status, failureMode)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return false
        const message = error instanceof Error ? error.message : 'Codex could not start.'
        emitError(message)
        updateModel(
          failureMode === 'stopped'
            ? { status: 'stopped', currentCredentialId }
            : { status: 'error', message, currentCredentialId },
        )
        return false
      }
    },
    [applyTerminalStatus, emitError, updateModel],
  )

  const start = React.useCallback(async () => {
    return runLifecycle(() => startCodex(undefined, true), 'error', null)
  }, [runLifecycle])

  const restart = React.useCallback(
    async (credentialId: string) => {
      return runLifecycle(() => restartCodex(credentialId, true), 'error', credentialId)
    },
    [runLifecycle],
  )

  const refresh = React.useCallback(async () => {
    try {
      const initial = await fetchCodexStatus()
      if (initial.status === 'starting' || initial.status === 'restarting') {
        updateModel({
          status: 'starting',
          activeCredentialId: initial.activeCredentialId,
          currentCredentialId: initial.currentCredentialId,
        })
        applyTerminalStatus(await waitForTerminalStatus(), 'error')
        return
      }
      applyTerminalStatus(initial, 'error')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : 'Codex status is unavailable.'
      const currentCredentialId =
        modelRef.current.status === 'started'
          ? modelRef.current.codex.currentCredentialId
          : modelRef.current.currentCredentialId
      emitError(message)
      updateModel({ status: 'error', message, currentCredentialId })
    }
  }, [applyTerminalStatus, emitError, updateModel, waitForTerminalStatus])

  React.useEffect(() => {
    if (bootstrapStartedRef.current) return
    bootstrapStartedRef.current = true
    const controller = new AbortController()
    let disposed = false

    const bootstrap = async () => {
      try {
        let status = await fetchCodexStatus(controller.signal)
        if (disposed) return
        if (status.status === 'ready') {
          updateModel({ status: 'started', codex: status })
          return
        }
        if (status.status === 'starting' || status.status === 'restarting') {
          updateModel({
            status: 'starting',
            activeCredentialId: status.activeCredentialId,
            currentCredentialId: status.currentCredentialId,
          })
          status = await waitForTerminalStatus(controller.signal)
          if (disposed) return
          if (status.status === 'ready') {
            updateModel({ status: 'started', codex: status })
            return
          }
          if (status.status === 'failed') {
            applyTerminalStatus(status, 'stopped')
            return
          }
        }
        if (!status.currentCredentialId) {
          updateModel({ status: 'stopped', currentCredentialId: null })
          return
        }
        updateModel({ status: 'stopped', currentCredentialId: status.currentCredentialId })
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return
        const message = error instanceof Error ? error.message : 'Codex could not start.'
        emitError(message)
        updateModel({ status: 'stopped', currentCredentialId: null })
      } finally {
        if (!disposed) setBootstrapping(false)
      }
    }

    void bootstrap()
    return () => {
      disposed = true
      bootstrapStartedRef.current = false
      controller.abort()
    }
  }, [applyTerminalStatus, emitError, runLifecycle, updateModel, waitForTerminalStatus])

  return {
    model,
    bootstrapping,
    errorEvent,
    start,
    restart,
    refresh,
    reportUnavailable: () => void refresh(),
  }
}

function waitForPoll(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = window.setTimeout(resolve, STATUS_POLL_MS)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
