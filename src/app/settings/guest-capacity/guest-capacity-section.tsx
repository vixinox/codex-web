import * as React from 'react'
import { RefreshCwIcon } from 'lucide-react'

import { fetchGuestCapacity } from '@/lib/bridge/http/guest'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Separator } from '@/components/ui/separator'
import { useSettingsLoadEnter } from '../use-settings-load-enter'

type GuestCapacity = {
  globalDailyTokenLimit: number
  globalDailyTokenUsed: number
  globalDailyTokenAvailable: number
  perGuestDailyTokenLimit: number
  perGuestDailyTokenUsed: number
  perGuestDailyTokenAvailable: number
  maxTokensPerTurn: number
  maxActiveThreads: number
  activeThreads: number
  maxQueue: number
  queuedTurns: number
  resetAt: string
}

const REQUIRED_NUMBER_FIELDS = [
  'globalDailyTokenLimit',
  'globalDailyTokenUsed',
  'globalDailyTokenAvailable',
  'perGuestDailyTokenLimit',
  'perGuestDailyTokenUsed',
  'perGuestDailyTokenAvailable',
  'maxTokensPerTurn',
  'maxActiveThreads',
  'activeThreads',
  'maxQueue',
  'queuedTurns',
] as const satisfies readonly (keyof GuestCapacity)[]

function parseCapacity(value: unknown): GuestCapacity | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  for (const field of REQUIRED_NUMBER_FIELDS)
    if (typeof candidate[field] !== 'number' || !Number.isFinite(candidate[field])) return null
  if (typeof candidate.resetAt !== 'string') return null
  return candidate as GuestCapacity
}

export function GuestCapacitySection() {
  const [capacity, setCapacity] = React.useState<GuestCapacity | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let active = true
    setFailed(false)
    void fetchGuestCapacity()
      .then((value) => {
        if (!active) return undefined
        const parsed = parseCapacity(value)
        if (parsed) setCapacity(parsed)
        else setFailed(true)
        return undefined
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [reloadToken])

  return (
    <section className="flex flex-col gap-5" aria-labelledby="guest-capacity-heading">
      <div className="flex flex-col gap-1">
        <h1 id="guest-capacity-heading" className="text-xl">
          Guest capacity
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Live admission limits and usage for the isolated Guest runtime.
        </p>
      </div>
      {capacity ? (
        <CapacityCard capacity={capacity} />
      ) : failed ? (
        <Alert>
          <AlertTitle>Live Guest capacity is unavailable</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>The isolated Guest runtime did not report admission limits.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              <RefreshCwIcon /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground" role="status">
          Loading live Guest capacity.
        </p>
      )}
    </section>
  )
}

function CapacityCard({ capacity }: { capacity: GuestCapacity }) {
  const cardRef = useSettingsLoadEnter<HTMLDivElement>([capacity])
  const globalTokens = {
    used: capacity.globalDailyTokenUsed,
    limit: capacity.globalDailyTokenLimit,
  }
  const guestTokens = {
    used: capacity.perGuestDailyTokenUsed,
    limit: capacity.perGuestDailyTokenLimit,
  }
  return (
    <Card ref={cardRef}>
      <CardHeader>
        <CardTitle className="text-base">Admission limits</CardTitle>
        <CardDescription>
          Daily token quotas reset at {formatResetAt(capacity.resetAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Meter
          label="Shared daily tokens"
          used={globalTokens.used}
          limit={globalTokens.limit}
          detail={`${formatTokens(remaining(globalTokens.limit, globalTokens.used))} available`}
        />
        <Meter
          label="Your daily tokens"
          used={guestTokens.used}
          limit={guestTokens.limit}
          detail={`${formatTokens(remaining(guestTokens.limit, guestTokens.used))} available`}
        />
        <Separator />
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">Per-turn token limit</span>
          <span className="text-muted-foreground tabular-nums">
            {formatTokens(capacity.maxTokensPerTurn)}
          </span>
        </div>
        <Meter
          label="Running turns"
          used={capacity.activeThreads}
          limit={capacity.maxActiveThreads}
          detail={`${capacity.activeThreads} of ${capacity.maxActiveThreads} slots in use`}
        />
        <Meter
          label="Queued turns"
          used={capacity.queuedTurns}
          limit={capacity.maxQueue}
          detail={`${capacity.queuedTurns} of ${capacity.maxQueue} queue slots in use`}
        />
      </CardContent>
    </Card>
  )
}

function Meter({
  label,
  used,
  limit,
  detail,
}: {
  label: string
  used: number
  limit: number
  detail: string
}) {
  const safeLimit = Math.max(1, limit)
  const clampPercent = (value: number) => Math.min(100, Math.max(0, (value / safeLimit) * 100))
  const usedPercent = clampPercent(used)
  const available = Math.max(0, limit - used)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <HoverCard>
          <HoverCardTrigger render={<span />} className="w-fit text-sm font-medium hover:underline">
            {label}
          </HoverCardTrigger>
          <HoverCardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Used</dt>
              <dd className="text-right font-medium tabular-nums">{formatExact(used)}</dd>
              <dt className="text-muted-foreground">Limit</dt>
              <dd className="text-right font-medium tabular-nums">{formatExact(limit)}</dd>
              <dt className="text-muted-foreground">Available</dt>
              <dd className="text-right font-medium tabular-nums">{formatExact(available)}</dd>
            </dl>
          </HoverCardContent>
        </HoverCard>
        <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-valuetext={`${used} of ${limit} used, ${detail}`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary" style={{ width: `${usedPercent}%` }} />
      </div>
    </div>
  )
}

function remaining(limit: number, used: number) {
  return Math.max(0, limit - used)
}

function formatExact(value: number) {
  return value.toLocaleString()
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${trimTrailingZero(value / 1_000_000)}M`
  if (value >= 1_000) return `${trimTrailingZero(value / 1_000)}k`
  return String(value)
}

function trimTrailingZero(value: number) {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
}

function formatResetAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'the next UTC day boundary'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
