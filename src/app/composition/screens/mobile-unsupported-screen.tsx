import { MonitorX } from 'lucide-react'
import { CodexLogo } from '@/components/shared/codex-logo'

export function MobileUnsupportedScreen() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-app-canvas px-6 py-12 text-center text-app-text">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <CodexLogo className="size-12" />
        <div
          aria-hidden="true"
          className="bg-app-surface-hover rounded-full p-3 text-app-text-muted"
        >
          <MonitorX className="size-6 stroke-[1.5]" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-medium tracking-tight">暂不支持移动端访问</h1>
        </div>
      </div>
    </main>
  )
}
