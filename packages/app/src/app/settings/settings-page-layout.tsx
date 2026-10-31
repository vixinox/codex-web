import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useNativeFadeEnter } from '@/lib/platform/browser/use-native-enter'

export const SETTINGS_LOADING_DELAY = 400

export function SettingsPageLayout({
  children,
  resetKey,
  pageTitle,
  pageTitleVisible = true,
}: {
  children: React.ReactNode
  resetKey: string
  pageTitle?: string
  pageTitleVisible?: boolean
}) {
  const [retryVersion, setRetryVersion] = React.useState(0)

  return (
    <div className="flex h-full flex-1 flex-col overflow-auto overscroll-none text-foreground">
      <div
        className="pointer-events-none sticky top-0 z-10 -mb-14 flex h-10 min-h-14 shrink-0 bg-linear-to-b from-app-surface from-80% to-transparent"
        aria-hidden="true"
      />
      <div className="px-8 py-20 xl:py-24">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-16">
          {pageTitle ? (
            <h1 className={pageTitleVisible ? 'text-xl' : 'sr-only'}>{pageTitle}</h1>
          ) : null}
          <SettingsPageErrorBoundary
            key={`${resetKey}:${retryVersion}`}
            onRetry={() => setRetryVersion((version) => version + 1)}
          >
            <React.Suspense fallback={<SettingsPageDelayedLoading />}>{children}</React.Suspense>
          </SettingsPageErrorBoundary>
        </div>
      </div>
    </div>
  )
}

export function SettingsPageLoading({ message = 'Loading settings...' }: { message?: string }) {
  return (
    <div
      className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
      role="status"
    >
      <Spinner />
      <span>{message}</span>
    </div>
  )
}

export function SettingsPageDelayedLoading({
  message = 'Loading settings...',
}: {
  message?: string
}) {
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), SETTINGS_LOADING_DELAY)
    return () => window.clearTimeout(timer)
  }, [])

  return visible ? <SettingsPageLoading message={message} /> : null
}

export function SettingsSection({
  title,
  description,
  action,
  headingLevel = 2,
  children,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  headingLevel?: 1 | 2
  children: React.ReactNode
}) {
  const headingId = React.useId()
  const Heading = headingLevel === 1 ? 'h1' : 'h2'

  return (
    <section className="flex w-full flex-col gap-8" aria-labelledby={headingId}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Heading id={headingId} className="text-xl">
            {title}
          </Heading>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function SettingsSectionContent({
  ready,
  message,
  children,
}: {
  ready: boolean
  message?: string
  children: React.ReactNode
}) {
  const contentRef = useNativeFadeEnter<HTMLDivElement>([ready], { duration: 0.22 })
  const [showLoading, setShowLoading] = React.useState(false)

  React.useEffect(() => {
    if (ready) {
      setShowLoading(false)
      return undefined
    }
    const timer = window.setTimeout(() => setShowLoading(true), SETTINGS_LOADING_DELAY)
    return () => window.clearTimeout(timer)
  }, [ready])

  if (!ready) return showLoading ? <SettingsPageLoading message={message} /> : null
  return <div ref={contentRef}>{children}</div>
}

export function SettingsPageError({
  message = 'This settings page could not be rendered.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div
      className="flex min-h-40 flex-col items-center justify-center gap-3 text-center"
      role="alert"
    >
      <p className="text-sm text-destructive">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

class SettingsPageErrorBoundary extends React.Component<
  { children: React.ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) return <SettingsPageError onRetry={this.props.onRetry} />
    return this.props.children
  }
}
