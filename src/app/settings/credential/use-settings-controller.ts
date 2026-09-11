import * as React from 'react'

import {
  createCredential,
  deleteCredential,
  fetchCredentials,
  selectCurrentCredential,
  testCredential,
  type CredentialSummary,
} from '@/lib/bridge/http/credentials'
import type { CredentialFormErrors, SettingsCollection } from '@/app/settings/model/types'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'

export type SettingsController = {
  credentials: SettingsCollection<CredentialSummary>
  selectedCredentialId: string | null
  activeCredentialId: string | null
  credentialErrors: CredentialFormErrors
  credentialActionError: string | null
  credentialSavePending: boolean
  codexActionPending: boolean
  resetCredentialForm: () => void
  saveCredential: (input: { provider: string; baseUrl: string; apiKey: string }) => Promise<boolean>
  selectCredential: (id: string) => Promise<void>
  deleteCredential: (id: string) => Promise<void>
  retryCredentials: () => void
  testSavedCredential: (credential: CredentialSummary) => Promise<boolean>
}

const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i

export function useSettingsController(runtime: CodexRuntimeController): SettingsController {
  const [credentials, setCredentials] = React.useState<SettingsCollection<CredentialSummary>>({
    status: 'loading',
  })
  const [selectedCredentialId, setSelectedCredentialId] = React.useState<string | null>(null)
  const [credentialErrors, setCredentialErrors] = React.useState<CredentialFormErrors>({})
  const [credentialActionError, setCredentialActionError] = React.useState<string | null>(null)
  const [credentialSavePending, setCredentialSavePending] = React.useState(false)
  const [codexActionPending, setCodexActionPending] = React.useState(false)
  const [retryKey, setRetryKey] = React.useState(0)

  const loadCredentials = React.useCallback(async (signal?: AbortSignal) => {
    const snapshot = await fetchCredentials(signal)
    setCredentials({ status: 'ready', items: snapshot.items })
    setSelectedCredentialId(snapshot.currentCredentialId)
    return snapshot
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    void fetchCredentials(controller.signal)
      .then((snapshot) => {
        setCredentials({ status: 'ready', items: snapshot.items })
        setSelectedCredentialId(snapshot.currentCredentialId)
        return undefined
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setCredentials({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'Could not load credentials. Try again.',
        })
      })
    return () => controller.abort()
  }, [retryKey])

  async function saveCredential(input: { provider: string; baseUrl: string; apiKey: string }) {
    setCredentialErrors({})
    setCredentialActionError(null)
    const nextErrors: CredentialFormErrors = {}
    if (!PROVIDER_PATTERN.test(input.provider.trim())) {
      nextErrors.provider = 'Use up to 32 letters, numbers, dots, underscores, or hyphens.'
    }
    try {
      const parsed = new URL(input.baseUrl.trim())
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error()
    } catch {
      nextErrors.baseUrl = 'Enter an absolute HTTP or HTTPS URL.'
    }
    if (!input.apiKey.trim()) nextErrors.apiKey = 'API key is required.'
    if (Object.keys(nextErrors).length > 0) {
      setCredentialErrors(nextErrors)
      return false
    }
    setCredentialSavePending(true)
    try {
      await createCredential(input)
      await loadCredentials()
      await runtime.refresh()
      return true
    } catch (error) {
      setCredentialActionError(
        error instanceof Error ? error.message : 'Could not save credential.',
      )
      throw error
    } finally {
      setCredentialSavePending(false)
    }
  }

  function resetCredentialForm() {
    setCredentialErrors({})
    setCredentialActionError(null)
  }

  async function selectCredential(id: string) {
    setCredentialActionError(null)
    setCodexActionPending(true)
    try {
      const currentCredentialId = await selectCurrentCredential(id)
      setSelectedCredentialId(currentCredentialId)
      if (
        runtime.model.status === 'started' &&
        runtime.model.codex.activeCredentialId !== currentCredentialId
      ) {
        await runtime.restart(currentCredentialId)
      } else {
        await runtime.refresh()
      }
    } catch (error) {
      setCredentialActionError(
        error instanceof Error ? error.message : 'Could not switch credential.',
      )
      throw error
    } finally {
      setCodexActionPending(false)
    }
  }

  async function deleteSavedCredential(id: string) {
    setCredentialActionError(null)
    try {
      await deleteCredential(id)
      await loadCredentials()
      await runtime.refresh()
    } catch (error) {
      setCredentialActionError(
        error instanceof Error ? error.message : 'Could not delete credential.',
      )
      throw error
    }
  }

  const activeCredentialId =
    runtime.model.status === 'started'
      ? runtime.model.codex.activeCredentialId
      : runtime.model.status === 'starting'
        ? runtime.model.activeCredentialId
        : null

  return {
    credentials,
    selectedCredentialId,
    activeCredentialId,
    credentialErrors,
    credentialActionError,
    credentialSavePending,
    codexActionPending,
    resetCredentialForm,
    saveCredential,
    selectCredential,
    deleteCredential: deleteSavedCredential,
    retryCredentials: () => setRetryKey((value) => value + 1),
    testSavedCredential: async (credential) => testCredential(credential.id),
  }
}
