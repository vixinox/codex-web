import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Copy, KeyRound, RefreshCw } from 'lucide-react'
import {
  emptyOwnerManagementSnapshot,
  formatDeviceDate,
  type FirstSessionPayload,
  type ManagementQr,
  type OwnerManagementClient,
} from './owner-management-model'
import { buildFirstSessionUrl } from '@/lib/remote/relay-profile'

export function OwnerManageScreen({ client }: { client: OwnerManagementClient }) {
  const [snapshot, setSnapshot] = useState(emptyOwnerManagementSnapshot)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false)
  const [firstSession, setFirstSession] = useState<FirstSessionPayload | null>(null)
  const [firstSessionImage, setFirstSessionImage] = useState<string | null>(null)
  const [managementQr, setManagementQr] = useState<ManagementQr | null>(null)
  const [managementQrImage, setManagementQrImage] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<{
    ticket: string
    origin: string
    expiresAt: string
  } | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setSnapshot(await client.getSnapshot())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Owner security state')
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
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-sm text-muted-foreground">Owner</p>
          <h1 className="text-2xl font-semibold">Security and devices</h1>
        </header>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Passkeys</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 border-b pb-3">
              <span>Remote origin · configured deployment</span>
              <Badge variant={snapshot.remotePasskeyAvailable ? 'default' : 'secondary'}>
                {snapshot.remotePasskeyAvailable ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            {!snapshot.remotePasskeyAvailable ? (
              <Button
                disabled={busy === 'remote-passkey'}
                onClick={() => void act('remote-passkey', () => client.registerPasskey())}
              >
                <KeyRound className="size-4" /> Register remote Passkey
              </Button>
            ) : null}
            <div className="flex items-center justify-between gap-4 border-b pb-3">
              <span>Local origin · localhost</span>
              <Badge variant={snapshot.localPasskeyAvailable ? 'default' : 'secondary'}>
                {snapshot.localPasskeyAvailable ? 'Configured' : 'Not configured'}
              </Badge>
            </div>
            <Button
              variant="outline"
              disabled={busy === 'local-ticket'}
              onClick={() =>
                void act('local-ticket', async () =>
                  setEnrollment(await client.issueLocalEnrollmentTicket()),
                )
              }
            >
              Issue localhost enrollment ticket
            </Button>
            {enrollment ? (
              <div className="space-y-2 border-l-2 border-border pl-3 text-sm">
                <p>Open {enrollment.origin} to register a local-only Passkey.</p>
                <code className="block break-all text-xs">{enrollment.ticket}</code>
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(enrollment.expiresAt).toLocaleTimeString()}
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    void act('local-passkey', async () => {
                      await client.registerPasskey(enrollment.ticket)
                      setEnrollment(null)
                      await refresh()
                    })
                  }
                >
                  Register local Passkey in this browser
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Management QR request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Create a five-minute, single-use request reference. It does not create a session by
              itself.
            </p>
            {managementQr && managementQrImage ? (
              <div className="flex flex-wrap items-start gap-4">
                <img
                  src={managementQrImage}
                  alt="Management QR request"
                  className="size-56 bg-white p-2"
                />
                <div className="space-y-2 text-sm">
                  <p>Expires {new Date(managementQr.expiresAt).toLocaleTimeString()}</p>
                  <code className="block max-w-sm break-all text-xs">{managementQr.reference}</code>
                  <Button
                    variant="outline"
                    disabled={busy === 'management-qr-cancel'}
                    onClick={() =>
                      void act('management-qr-cancel', async () => {
                        await client.cancelManagementQr()
                        setManagementQr(null)
                        setManagementQrImage(null)
                      })
                    }
                  >
                    Cancel request
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={busy === 'management-qr'}
                onClick={() =>
                  void act('management-qr', async () => {
                    const issued = await client.issueManagementQr()
                    setManagementQr(issued)
                    setManagementQrImage(
                      await QRCode.toDataURL(
                        JSON.stringify({
                          version: 1,
                          type: 'management_request',
                          reference: issued.reference,
                          expiresAt: issued.expiresAt,
                        }),
                        { margin: 2, width: 240, errorCorrectionLevel: 'Q' },
                      ),
                    )
                  })
                }
              >
                Generate management QR
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recovery codes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {snapshot.recoveryCodesAvailable
                ? 'A recovery batch is configured.'
                : 'No recovery path is configured.'}
            </p>
            <Button
              variant="outline"
              disabled={busy === 'recovery'}
              onClick={() =>
                void act('recovery', async () => {
                  setRecoveryCodes(await client.generateRecoveryCodes())
                  setRecoveryAcknowledged(false)
                })
              }
            >
              <RefreshCw className="size-4" /> Generate recovery batch
            </Button>
            {recoveryCodes ? (
              <div className="space-y-3 border-t pt-3">
                <pre className="grid grid-cols-2 gap-2 whitespace-pre-wrap break-all text-sm">
                  {recoveryCodes.join('\n')}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void navigator.clipboard.writeText(recoveryCodes.join('\n'))}
                  >
                    <Copy className="size-4" /> Copy codes
                  </Button>
                  <Button
                    disabled={recoveryAcknowledged}
                    onClick={() => {
                      setRecoveryAcknowledged(true)
                      setRecoveryCodes(null)
                    }}
                  >
                    I saved these codes
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Codes are shown once. Generating a new batch invalidates the previous one.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First remote session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use a one-time bootstrap URL or QR to connect the first remote device.
            </p>
            {firstSession && firstSessionImage ? (
              <div className="flex flex-wrap items-start gap-4">
                <img
                  src={firstSessionImage}
                  alt="First-session QR code"
                  className="size-56 bg-white p-2"
                />
                <div className="space-y-2 text-sm">
                  <p>Expires {new Date(firstSession.expiresAt).toLocaleTimeString()}</p>
                  <code className="block max-w-sm break-all text-xs">
                    {buildFirstSessionUrl(firstSession.reference)}
                  </code>
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        buildFirstSessionUrl(firstSession.reference),
                      )
                    }
                  >
                    <Copy className="size-4" /> Copy URL
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFirstSession(null)
                      setFirstSessionImage(null)
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                disabled={busy === 'first-session'}
                onClick={() =>
                  void act('first-session', async () => {
                    const issued = await client.issueFirstSession()
                    const url = buildFirstSessionUrl(issued.payload.reference)
                    const image = await QRCode.toDataURL(url, {
                      margin: 2,
                      width: 240,
                      errorCorrectionLevel: 'Q',
                    })
                    setFirstSession(issued.payload)
                    setFirstSessionImage(image)
                  })
                }
              >
                Generate bootstrap QR
              </Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Remote devices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.devices.length ? (
              snapshot.devices.map((device) => (
                <div
                  className="flex items-center justify-between gap-3 border-b pb-3 last:border-0"
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
            ) : (
              <p className="text-sm text-muted-foreground">No remote devices.</p>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                variant="outline"
                disabled={busy === 'revoke-all'}
                onClick={() => void act('revoke-all', () => client.revokeAllSessions())}
              >
                Revoke all remote sessions
              </Button>
              <Button
                variant="outline"
                disabled={busy === 'revoke-devices'}
                onClick={() => void act('revoke-devices', () => client.revokeAllDevices())}
              >
                Revoke all devices
              </Button>
              <Button
                variant="destructive"
                disabled={busy === 'trust-reset'}
                onClick={() => void act('trust-reset', () => client.resetTrust())}
              >
                Reset remote trust
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
