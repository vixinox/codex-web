import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { CredentialFormErrors } from '../model/types'
import type { SettingsController } from './use-settings-controller'

function formText(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export function CredentialForm({
  errors,
  saveError,
  savePending,
  onSubmit,
  onSuccess,
}: {
  errors: CredentialFormErrors
  saveError?: string | null
  savePending: boolean
  onSubmit: SettingsController['saveCredential']
  onSuccess?: () => void
}) {
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const input = {
      provider: formText(data, 'provider'),
      baseUrl: formText(data, 'base-url'),
      apiKey: formText(data, 'api-key'),
    }
    const apiKey = form.elements.namedItem('api-key')
    if (apiKey instanceof HTMLInputElement) apiKey.value = ''
    try {
      const saved = await onSubmit(input)
      if (saved) onSuccess?.()
    } catch {
      // The parent renders the safe action error.
    }
  }

  return (
    <form className="w-full" onSubmit={submit}>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.provider)}>
          <FieldLabel htmlFor="offline-provider">Provider</FieldLabel>
          <Input
            id="offline-provider"
            name="provider"
            defaultValue="proxy"
            autoComplete="off"
            maxLength={32}
            aria-invalid={Boolean(errors.provider)}
            required
          />
          <FieldError>{errors.provider}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.baseUrl)}>
          <FieldLabel htmlFor="offline-base-url">Base URL</FieldLabel>
          <Input
            id="offline-base-url"
            name="base-url"
            type="url"
            defaultValue="https://api.openai.com"
            autoComplete="url"
            aria-invalid={Boolean(errors.baseUrl)}
            required
          />
          <FieldError>{errors.baseUrl}</FieldError>
        </Field>
        <Field data-invalid={Boolean(errors.apiKey)}>
          <FieldLabel htmlFor="offline-api-key">API key</FieldLabel>
          <Input
            id="offline-api-key"
            name="api-key"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.apiKey)}
            required
          />
          <FieldError>{errors.apiKey}</FieldError>
        </Field>
        {saveError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save credential</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        <Field orientation="horizontal">
          <Button type="submit" disabled={savePending}>
            {savePending ? <Spinner data-icon="inline-start" /> : null}
            {savePending ? 'Saving...' : 'Save credential'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
