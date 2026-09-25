import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchContextWindow, updateContextWindow } from '@/lib/bridge/http/configuration'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'

export function ConfigurationSection({ runtime }: { runtime: CodexRuntimeController }) {
  const [value, setValue] = React.useState('')
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = React.useState<string | null>(null)
  const [validationError, setValidationError] = React.useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [retryKey, setRetryKey] = React.useState(0)
  const runtimeStarted = runtime.model.status === 'started'
  const requestKey = `${runtimeStarted}:${retryKey}`
  const [settledRequest, setSettledRequest] = React.useState<string | null>(null)
  const displayStatus = !runtimeStarted
    ? 'error'
    : settledRequest === requestKey
      ? status
      : 'loading'
  const displayError = runtimeStarted ? error : 'Start Codex to view and edit configuration.'

  React.useEffect(() => {
    if (!runtimeStarted) return
    const controller = new AbortController()
    void fetchContextWindow(controller.signal)
      .then((config) => {
        if (controller.signal.aborted) return undefined
        setValue(String(config.modelContextWindow))
        setStatus('ready')
        setError(null)
        setSettledRequest(requestKey)
        return undefined
      })
      .catch((nextError: unknown) => {
        if (
          controller.signal.aborted ||
          (nextError instanceof DOMException && nextError.name === 'AbortError')
        )
          return
        setStatus('error')
        setError(nextError instanceof Error ? nextError.message : 'Could not load configuration.')
        setSettledRequest(requestKey)
      })
    return () => controller.abort()
  }, [requestKey, runtimeStarted])

  const parsedValue = parseContextWindow(value)
  const requestSave = () => {
    if (!parsedValue) {
      setValidationError('Enter a positive whole number within the safe integer range.')
      return
    }
    setValidationError(null)
    setConfirmOpen(true)
  }
  const confirmSave = async () => {
    if (!parsedValue || runtime.model.status !== 'started' || saving) return
    const credentialId = runtime.model.codex.activeCredentialId
    if (!credentialId) {
      setError('Select a Codex credential before restarting.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateContextWindow(parsedValue)
      setConfirmOpen(false)
      const restarted = await runtime.restart(credentialId)
      if (!restarted) setError('Configuration was saved, but Codex could not restart.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not save configuration.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-8" aria-labelledby="configuration-heading">
      <h1 id="configuration-heading" className="text-xl">
        Configuration
      </h1>
      {displayStatus === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load configuration</AlertTitle>
          <AlertDescription>{displayError}</AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            Retry
          </Button>
        </Alert>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-context-window">Context window</Label>
            <p className="text-sm text-muted-foreground">
              Maximum context size in tokens. Saving this setting restarts Codex.
            </p>
            <Input
              id="model-context-window"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={value}
              disabled={displayStatus !== 'ready' || saving}
              aria-invalid={Boolean(validationError)}
              onChange={(event) => {
                setValue(event.target.value)
                setValidationError(null)
              }}
            />
            {validationError ? <p className="text-sm text-destructive">{validationError}</p> : null}
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={displayStatus !== 'ready' || saving}
              onClick={requestSave}
            >
              Save
            </Button>
          </div>
        </div>
      )}
      {displayError && displayStatus === 'ready' ? (
        <p className="text-sm text-destructive" role="alert">
          {displayError}
        </p>
      ) : null}
      <AlertDialog open={confirmOpen} onOpenChange={saving ? undefined : setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart Codex?</AlertDialogTitle>
            <AlertDialogDescription>
              Saving this context window will restart Codex and interrupt any active conversation or
              Turn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault()
                void confirmSave()
              }}
            >
              {saving ? 'Saving...' : 'Save and restart'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function parseContextWindow(value: string) {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
