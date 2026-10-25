import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  emptyOwnerManagementSnapshot,
  formatDeviceDate,
  type OwnerManagementClient,
} from './owner-management-model'

export function OwnerManageScreen({ client }: { client: OwnerManagementClient }) {
  const [snapshot, setSnapshot] = useState(emptyOwnerManagementSnapshot)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setError(null)
    try {
      setSnapshot(await client.getSnapshot())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load security state')
    }
  }, [client])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const act = async (key: string, operation: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await operation()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operation failed')
    } finally {
      setBusy(null)
    }
  }
  return (
    <main className="min-h-svh bg-background p-6 text-foreground md:p-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header>
          <p className="text-sm text-muted-foreground">Owner security</p>
          <h1 className="text-2xl font-semibold">Manage trusted browsers</h1>
        </header>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Two-factor authentication</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <span>{snapshot.totpEnabled ? 'TOTP is enabled' : 'TOTP is not configured'}</span>
            <Badge variant={snapshot.totpEnabled ? 'default' : 'secondary'}>
              {snapshot.totpEnabled ? 'Enabled' : 'Setup required'}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pending binding requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.bindingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            ) : (
              snapshot.bindingRequests.map((request) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0"
                  key={request.requestId}
                >
                  <div>
                    <p className="font-medium">{request.source}</p>
                    <p className="text-xs text-muted-foreground">
                      {request.publicKeyFingerprint} · expires {formatDeviceDate(request.expiresAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy === request.requestId}
                    onClick={() =>
                      void act(request.requestId, () => client.approveBinding(request.requestId))
                    }
                  >
                    Approve
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Trusted devices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.devices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No trusted devices.</p>
            ) : (
              snapshot.devices.map((device) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0"
                  key={device.id}
                >
                  <div>
                    <p className="font-medium">{device.id}</p>
                    <p className="text-xs text-muted-foreground">
                      Last seen {formatDeviceDate(device.lastSeenAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === device.id}
                    onClick={() => void act(device.id, () => client.revokeDevice(device.id))}
                  >
                    Revoke
                  </Button>
                </div>
              ))
            )}
            <Button
              variant="destructive"
              disabled={busy === 'reset'}
              onClick={() => void act('reset', client.resetTrust)}
            >
              Reset all trust
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
