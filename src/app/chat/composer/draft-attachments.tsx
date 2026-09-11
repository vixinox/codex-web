import { BracesIcon, XIcon } from 'lucide-react'
import { formatCount, type CodeSnippetAttachment } from './draft-model'

export function DraftAttachments({
  attachments,
  disabled,
  submitting,
  onRemove,
}: {
  attachments: readonly CodeSnippetAttachment[]
  disabled: boolean
  submitting: boolean
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div
      className="mb-3 flex w-full [scrollbar-color:var(--app-border-strong)_transparent] gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-app-border-strong [&::-webkit-scrollbar-track]:bg-transparent"
      role="list"
      aria-label="Code snippets"
    >
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          role="listitem"
          className="flex w-72 max-w-[calc(100vw-4rem)] shrink-0 items-center gap-3 rounded-lg border border-app-border bg-app-surface p-2.5 text-foreground"
        >
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-app-surface-subtle text-app-text-muted">
            <BracesIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{attachment.title}</span>
            <span className="block truncate text-xs text-app-text-subtle">
              {attachment.lineCount} {attachment.lineCount === 1 ? 'line' : 'lines'} ·{' '}
              {formatCount(attachment.characterCount)} characters
            </span>
          </span>
          <button
            type="button"
            className="app-interactive inline-flex size-7 shrink-0 items-center justify-center rounded-md text-app-text-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Remove code snippet: ${attachment.title}`}
            onClick={() => onRemove(attachment.id)}
            disabled={disabled || submitting}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
