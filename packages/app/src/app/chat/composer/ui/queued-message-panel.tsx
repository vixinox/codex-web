import { CornerDownRight, Pencil, Trash2, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ComposerActions, ComposerViewModel } from '@/app/chat/model/composer-types'

export function QueuedMessagePanel({
  queue,
  actions,
  hasDraft,
}: {
  queue: NonNullable<ComposerViewModel['queue']>
  actions: ComposerActions
  hasDraft: boolean
}) {
  const sending = queue.status === 'sending'
  return (
    <div className="flex w-full min-w-0 flex-col rounded-t-3xl bg-app-surface-subtle px-3 py-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm text-app-text-muted">
          {sending ? (
            <Spinner className="size-4 shrink-0" />
          ) : (
            <CornerDownRight className="size-4 shrink-0" />
          )}
          <span className="truncate" title={queue.text}>
            {queue.text}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Steer current turn"
            title="Steer current turn"
            disabled={sending || !queue.canSteer}
            onClick={() => void actions.steerQueued?.()}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete queued message"
            title="Delete queued message"
            disabled={sending}
            onClick={actions.deleteQueued}
          >
            <Trash2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit queued message"
            title={
              hasDraft
                ? 'Clear the current draft before editing the queued message'
                : 'Edit queued message'
            }
            disabled={sending || hasDraft}
            onClick={actions.editQueued}
          >
            <Pencil />
          </Button>
        </div>
      </div>
      {queue.error ? (
        <p role="alert" className="py-1 text-xs text-destructive">
          {queue.error}
        </p>
      ) : null}
    </div>
  )
}
