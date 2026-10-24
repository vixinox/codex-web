import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ThreadAssets } from '@/app/chat/transcript/thread-assets'
import { ThreadEmptyState } from '@/app/chat/transcript/thread-empty-state'
import type { ThreadPageSession } from '@/app/chat/session/interface'

export function ThreadPageSurface({
  controller,
  onRetry,
}: {
  controller: ThreadPageSession
  onRetry?: () => void
}) {
  const { model, retryState, inputErrors, lockEpoch, session, compacting, pendingAccepted } =
    controller
  if (model.status === 'empty') return <ThreadEmptyState />
  if (model.status === 'error')
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{model.message}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  if (!('thread' in model)) return <div />
  return (
    <section className="relative flex min-h-full flex-col" aria-label="Chat conversation">
      {inputErrors.length ? (
        <div className="mx-auto mb-4 w-full max-w-3xl px-4" role="alert">
          <Alert variant="destructive">
            <AlertDescription>Some Codex events could not be displayed.</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <ThreadAssets
        thread={model.thread}
        session={session}
        retryState={retryState}
        lockEpoch={lockEpoch}
        compacting={compacting}
        pendingAccepted={pendingAccepted}
      />
    </section>
  )
}
