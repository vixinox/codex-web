import type * as React from 'react'

export function WorkspaceFrame({
  navigation,
  children,
}: {
  navigation: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="relative flex h-svh w-full bg-sidebar">
      {navigation}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col rounded-tl-3xl border bg-app-surface">
        {children}
      </main>
    </div>
  )
}
