import { CodexLogo } from '@/components/shared/codex-logo'

export function CodexStartupScreen() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background text-foreground">
      <div
        className="flex flex-col items-center gap-4 text-center"
        role="status"
        aria-live="polite"
      >
        <CodexLogo className="size-12" />
        <p className="text-sm text-muted-foreground">Starting Codex...</p>
      </div>
    </main>
  )
}
