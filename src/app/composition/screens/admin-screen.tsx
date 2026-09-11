import * as React from 'react'
import { useNavigate } from 'react-router'
import { RefreshCw, ShieldCheck, Ban } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { signOut } from '@/lib/auth/auth-client'

type Overview = {
  runtime: { status: string; sandbox: string; network: string }
  stats: { activeLeases: number; activeThreads: number; queuedTurns: number; failedTurns: number }
  usage: Record<string, number | string>
}
type Lease = {
  id: string
  createdAt: string
  expiresAt: string
  status: string
  threadCount: number
}

export function AdminScreen() {
  const navigate = useNavigate()
  const [overview, setOverview] = React.useState<Overview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [leases, setLeases] = React.useState<Lease[]>([])
  const [revoking, setRevoking] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/admin-api/overview', { credentials: 'include' })
      if (!response.ok) throw new Error('Admin overview is unavailable')
      setOverview((await response.json()) as Overview)
      const leasesResponse = await fetch('/admin-api/leases', { credentials: 'include' })
      if (!leasesResponse.ok) throw new Error('Guest leases are unavailable')
      const leasePayload = (await leasesResponse.json()) as { leases: Lease[] }
      setLeases(leasePayload.leases)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Admin overview is unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  const revoke = async (leaseId: string) => {
    setRevoking(leaseId)
    try {
      const response = await fetch(`/admin-api/leases/${encodeURIComponent(leaseId)}/revoke`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Lease revoke failed')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lease revoke failed')
    } finally {
      setRevoking(null)
    }
  }

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  return (
    <main className="min-h-svh bg-background p-6 text-foreground md:p-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" /> Guest operations
            </p>
            <h1 className="text-2xl font-medium tracking-tight">Admin overview</h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh overview"
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
            </Button>
            <Button variant="outline" onClick={() => void signOut().then(() => navigate('/login'))}>
              Sign out
            </Button>
          </div>
        </header>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {overview ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(overview.stats).map(([label, value]) => (
                <Card key={label}>
                  <CardHeader>
                    <CardTitle className="text-sm font-normal text-muted-foreground">
                      {label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-2xl font-medium">{value}</CardContent>
                </Card>
              ))}
            </section>
            <Card>
              <CardHeader>
                <CardTitle>Runtime</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
                <span>Status: {overview.runtime.status}</span>
                <span>Sandbox: {overview.runtime.sandbox}</span>
                <span>Network: {overview.runtime.network}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Guest leases</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="p-2">Status</th>
                        <th className="p-2">Created</th>
                        <th className="p-2">Expires</th>
                        <th className="p-2">Threads</th>
                        <th className="p-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {leases.map((lease) => (
                        <tr key={lease.id} className="border-b last:border-0">
                          <td className="p-2">{lease.status}</td>
                          <td className="p-2">{new Date(lease.createdAt).toLocaleString()}</td>
                          <td className="p-2">{new Date(lease.expiresAt).toLocaleString()}</td>
                          <td className="p-2">{lease.threadCount}</td>
                          <td className="p-2 text-right">
                            {lease.status === 'active' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void revoke(lease.id)}
                                disabled={revoking === lease.id}
                              >
                                <Ban className="mr-1 size-4" />
                                Revoke
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </main>
  )
}
