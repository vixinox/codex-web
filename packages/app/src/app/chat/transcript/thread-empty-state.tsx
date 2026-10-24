import { CodexLogo } from '@/components/shared/codex-logo'

export function ThreadEmptyState({
  title = 'What should we build?',
  ariaLabel = 'Chat conversation',
}: {
  title?: string
  ariaLabel?: string
}) {
  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col px-4" aria-label={ariaLabel}>
      <div className="flex flex-1 items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-3 text-center text-foreground">
          <CodexLogo className="size-9" />
          <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
        </div>
      </div>
    </section>
  )
}
