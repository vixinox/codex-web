import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

export function ProjectNameDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'rename'
  initialName?: string
  onSubmit: (name: string) => Promise<void>
}) {
  if (!open) return null
  return (
    <OpenProjectNameDialog
      onOpenChange={onOpenChange}
      mode={mode}
      initialName={initialName}
      onSubmit={onSubmit}
    />
  )
}

function OpenProjectNameDialog({
  onOpenChange,
  mode,
  initialName,
  onSubmit,
}: {
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'rename'
  initialName: string
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = React.useState(initialName)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputId = React.useId()

  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name.trim())
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(name.trim())
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save this project.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Create project' : 'Rename project'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'A folder with this name will be created in your workspace.'
                : 'This changes the name shown in Codex Web. The folder stays in place.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(error) || (!valid && name.length > 0)}>
              <FieldLabel htmlFor={inputId}>Project name</FieldLabel>
              <Input
                id={inputId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
                autoFocus
                autoComplete="off"
                aria-invalid={Boolean(error) || (!valid && name.length > 0)}
                disabled={submitting}
              />
              <FieldDescription>
                Use letters, numbers, dots, underscores, or hyphens.
              </FieldDescription>
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting ? <Spinner data-icon="inline-start" /> : null}
              {submitting ? 'Saving...' : mode === 'create' ? 'Create project' : 'Save name'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
