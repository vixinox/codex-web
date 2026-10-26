import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  emptyOwnerManagementSnapshot,
  formatDeviceDate,
  type OwnerManagementClient,
} from './owner-management-model'

export function OwnerManageScreen({ client }: { client: OwnerManagementClient }) {
  const [snapshot, setSnapshot] = useState(emptyOwnerManagementSnapshot)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'offline' | 'session_expired' | 'failed'
  >('loading')
  const [totpPassword, setTotpPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [codesAcknowledged, setCodesAcknowledged] = useState(false)
  const refresh = useCallback(async () => {
    setError(null)
    setStatus('loading')
    try {
      setSnapshot(await client.getSnapshot())
      setStatus('ready')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to load security state'
      setError(message)
      setStatus(
        message.includes('UNAUTHORIZED')
          ? 'session_expired'
          : message.includes('closed') || message.includes('failed')
            ? 'offline'
            : 'failed',
      )
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
      setStatus('failed')
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
        {status === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading security state...</p>
        ) : null}
        {status === 'offline' ? (
          <p className="text-sm text-muted-foreground">Owner connection is offline.</p>
        ) : null}
        {status === 'session_expired' ? (
          <p className="text-sm text-destructive">Owner session expired. Sign in again.</p>
        ) : null}
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
          <CardContent className="space-y-3 border-t pt-4">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void act('totp-setup', async () => {
                  const result = await client.setupTotp(totpPassword)
                  setTotpUri(result.totpURI ?? null)
                  setTotpPassword('')
                })
              }}
            >
              <Input
                type="password"
                value={totpPassword}
                onChange={(event) => setTotpPassword(event.target.value)}
                placeholder="Owner password"
                aria-label="Owner password"
                disabled={snapshot.totpEnabled || busy === 'totp-setup'}
              />
              <Button
                type="submit"
                disabled={snapshot.totpEnabled || !totpPassword || busy === 'totp-setup'}
              >
                Set up TOTP
              </Button>
            </form>
            {totpUri ? (
              <code className="block break-all text-xs text-muted-foreground">{totpUri}</code>
            ) : null}
            {totpUri && !snapshot.totpEnabled ? (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void act('totp-verify', async () => {
                    const result = await client.verifyTotp(totpCode)
                    setRecoveryCodes(result.recoveryCodes)
                    setCodesAcknowledged(false)
                    setTotpCode('')
                  })
                }}
              >
                <Input
                  inputMode="numeric"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  placeholder="Authenticator code"
                  aria-label="Authenticator code"
                  disabled={busy === 'totp-verify'}
                />
                <Button type="submit" disabled={!totpCode || busy === 'totp-verify'}>
                  Verify TOTP
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recovery codes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void act('recovery-rotate', async () => {
                  const result = await client.generateRecoveryCodes(recoveryPassword || undefined)
                  setRecoveryCodes(result.recoveryCodes)
                  setCodesAcknowledged(false)
                  setRecoveryPassword('')
                })
              }}
            >
              <Input
                type="password"
                value={recoveryPassword}
                onChange={(event) => setRecoveryPassword(event.target.value)}
                placeholder="Owner password"
                aria-label="Owner password"
                disabled={!snapshot.totpEnabled || busy === 'recovery-rotate'}
              />
              <Button type="submit" disabled={!snapshot.totpEnabled || busy === 'recovery-rotate'}>
                Generate or rotate
              </Button>
            </form>
            {snapshot.recoveryCodesAvailable ? (
              <p className="text-sm text-muted-foreground">Recovery codes are configured.</p>
            ) : null}
            {recoveryCodes ? (
              <div className="space-y-3 rounded-md border p-3">
                <pre className="grid grid-cols-2 gap-1 text-sm">{recoveryCodes.join('\n')}</pre>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={codesAcknowledged}
                    onChange={(event) => setCodesAcknowledged(event.target.checked)}
                  />
                  I saved these codes
                </label>
                {codesAcknowledged ? (
                  <p className="text-xs text-muted-foreground">Codes will not be shown again.</p>
                ) : null}
              </div>
            ) : null}
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
                  {client.rejectBinding ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === request.requestId}
                      onClick={() =>
                        void act(request.requestId, () => client.rejectBinding(request.requestId))
                      }
                    >
                      Reject
                    </Button>
                  ) : null}
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
