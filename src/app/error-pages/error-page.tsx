import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ErrorPageProps = {
  /** HTTP status code shown as the hero numeral. */
  code: number | string
  /** Short heading stating what went wrong. */
  title: string
  /** One-line explanation rendered under the heading. */
  description: string
  /** Optional small glyph centered above the code. */
  icon?: ReactNode
  /** Action buttons rendered under the description. */
  actions?: ReactNode
  className?: string
}

export function ErrorPage({ code, title, description, icon, actions, className }: ErrorPageProps) {
  return (
    <div
      className={cn(
        'flex min-h-svh flex-col items-center justify-center gap-6 bg-app-canvas px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="text-app-text-subtle [&_svg]:size-5 [&_svg]:stroke-[1.5]"
        >
          {icon}
        </div>
      ) : null}
      <p
        aria-hidden="true"
        className="text-[clamp(4rem,14vw,7.5rem)] leading-none font-light tracking-tighter text-app-text-subtle select-none"
      >
        {code}
      </p>
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-xl font-medium tracking-tight text-app-text">{title}</h1>
        <p className="max-w-md text-sm text-balance text-app-text-muted">{description}</p>
      </div>
      {actions ? (
        <div className="mt-2 flex items-center justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
