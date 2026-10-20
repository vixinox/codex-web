import { CodexLogo } from '@/components/shared/codex-logo'
import { Button } from '@/components/ui/button'
import type { CodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'

export function RuntimePlaceholder({
  model,
  onRetry,
  onOpenSettings,
}: {
  model: CodexRuntimeController['model']
  onRetry: () => void | Promise<unknown>
  onOpenSettings: () => void
}) {
  if (model.status === 'stopped' && !model.currentCredentialId)
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-app-surface p-8 text-center text-foreground">
        <CodexLogo className="size-12" />
        <p className="text-sm text-app-text-muted">Configure Codex in Settings to continue.</p>
        <Button type="button" variant="secondary" onClick={onOpenSettings}>
          Open Settings
        </Button>
      </div>
    )
  if (model.status === 'error')
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-app-surface p-8 text-center text-foreground">
        <CodexLogo className="size-12" />
        <p className="max-w-md text-sm text-app-text-muted">{model.message}</p>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => void onRetry()}>
            Retry
          </Button>
          <Button type="button" variant="outline" onClick={onOpenSettings}>
            Open Settings
          </Button>
        </div>
      </div>
    )
  if (model.status === 'stopped')
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-app-surface p-8 text-center text-foreground">
        <CodexLogo className="size-12" />
        <p className="text-sm text-app-text-muted">Codex is stopped.</p>
        <Button type="button" variant="secondary" onClick={() => void onRetry()}>
          Start Codex
        </Button>
      </div>
    )
  return null
}
