import type * as React from 'react'

export function ComposerContainer({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative z-10 -mt-14 flex-none bg-linear-to-t from-app-surface from-80% to-transparent ${className}`.trim()}
    >
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </div>
  )
}
