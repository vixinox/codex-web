import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Shared visual shell; authentication, navigation and runtime stay with callers. */
export function WorkspaceLayout({
  sidebar,
  children,
  className,
}: {
  sidebar: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'app-shell relative flex h-svh max-h-svh w-full touch-pan-x overflow-hidden overscroll-none bg-sidebar',
        className,
      )}
    >
      {sidebar}
      <main className="app-main flex min-h-0 min-w-0 flex-1 flex-col bg-app-surface">
        {children}
      </main>
    </div>
  )
}
