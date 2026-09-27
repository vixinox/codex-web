import * as React from 'react'
import { useNavigate } from 'react-router'
import { Check, Cloud, ExternalLink, Loader2, Server, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { startGuestSession } from '@/lib/bridge/http/guest'
import { checkCurrentConnection } from '@/lib/connection/connection-client'
import type { ConnectionProfile } from '@/lib/connection/connection-profile'
import { trackProductEvent } from '@/lib/connection/telemetry'

type Source = 'hosted' | 'self_hosted' | 'guest'

const sourceDetails: Record<Source, { title: string; description: string; icon: typeof Cloud }> = {
  hosted: {
    title: 'Official service',
    description: 'Hosted access with automatic upgrades and cross-device availability.',
    icon: Cloud,
  },
  self_hosted: {
    title: 'Self-hosted',
    description: 'Use an instance you control. Remote instance configuration is coming next.',
    icon: Server,
  },
  guest: {
    title: 'Guest trial',
    description: 'Try Codex in a temporary, restricted workspace for 24 hours.',
    icon: UserRound,
  },
}

export function StartupScreen() {
  const navigate = useNavigate()
  const [selected, setSelected] = React.useState<Source>('self_hosted')
  const [connection, setConnection] = React.useState<ConnectionProfile | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function checkConnection() {
    setChecking(true)
    setError(null)
    try {
      const result = await checkCurrentConnection()
      setConnection(result)
      trackProductEvent(
        result.status === 'offline' || result.status === 'incompatible'
          ? 'startup_connection_failed'
          : 'startup_connection_checked',
      )
      if (result.status === 'offline')
        setError('The current instance is unavailable. Try again later.')
      if (result.status === 'incompatible')
        setError('This instance needs a newer compatible client or server version.')
    } catch {
      trackProductEvent('startup_connection_failed')
      setConnection(null)
      setError('The current instance could not be checked. Try again.')
    } finally {
      setChecking(false)
    }
  }

  async function continueWithSource() {
    if (!connection || connection.status === 'offline' || connection.status === 'incompatible') {
      await checkConnection()
      return
    }
    if (selected === 'guest') {
      if (!connection.capabilities.guestMode) {
        setError('Guest trial is not available on this instance.')
        return
      }
      setChecking(true)
      try {
        await startGuestSession()
        window.location.replace('/app')
      } catch {
        setError('Guest access could not be started. Try again.')
        setChecking(false)
      }
      return
    }
    navigate('/login')
  }

  const selectedDetails = sourceDetails[selected]
  const SelectedIcon = selectedDetails.icon
  const canContinue = connection?.status === 'ready' || connection?.status === 'needs_login'

  return (
    <main className="min-h-svh bg-background px-5 py-10 text-foreground sm:px-8 sm:py-14">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
        <header className="max-w-2xl space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Codex Web</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Choose where to work
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Connect to the current instance, then sign in or start a restricted Guest trial.
          </p>
        </header>
        <section aria-label="Service sources" className="grid gap-4 md:grid-cols-3">
          {(Object.keys(sourceDetails) as Source[]).map((source) => {
            const details = sourceDetails[source]
            const Icon = details.icon
            const unavailable = source === 'hosted'
            return (
              <button
                key={source}
                type="button"
                disabled={unavailable}
                onClick={() => setSelected(source)}
                className={`min-h-40 rounded-lg border p-5 text-left transition-colors ${selected === source ? 'border-foreground bg-muted/50' : 'border-border hover:border-foreground/40 hover:bg-muted/30'} ${unavailable ? 'cursor-not-allowed opacity-55' : ''}`}
              >
                <Icon className="mb-8 size-5" aria-hidden="true" />
                <span className="block font-medium">{details.title}</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                  {unavailable ? 'Available in a future hosted release.' : details.description}
                </span>
              </button>
            )
          })}
        </section>
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <SelectedIcon className="size-5" aria-hidden="true" />
              {selectedDetails.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-3 rounded-md border border-border/70 px-4 py-3 text-sm">
              {connection?.status === 'ready' || connection?.status === 'needs_login' ? (
                <Check className="size-4 text-emerald-600" aria-hidden="true" />
              ) : connection?.status === 'offline' || connection?.status === 'incompatible' ? (
                <X className="size-4 text-destructive" aria-hidden="true" />
              ) : (
                <span className="size-2 rounded-full bg-muted-foreground" aria-hidden="true" />
              )}
              <span>
                {connection?.status === 'ready'
                  ? 'Instance is ready.'
                  : connection?.status === 'needs_login'
                    ? 'Instance is ready. Sign-in is required.'
                    : connection?.status === 'offline'
                      ? 'Instance is offline.'
                      : connection?.status === 'incompatible'
                        ? 'Instance is incompatible.'
                        : 'Connection has not been checked.'}
              </span>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void checkConnection()}
                disabled={checking}
              >
                {checking ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Check connection
              </Button>
              <Button
                type="button"
                onClick={() => void continueWithSource()}
                disabled={checking || (!canContinue && !!connection)}
              >
                Continue
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  window.open(
                    'https://github.com/vixinox/codex-web',
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              >
                <ExternalLink className="mr-2 size-4" />
                Project
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
