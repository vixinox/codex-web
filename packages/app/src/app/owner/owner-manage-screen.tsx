import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Copy, KeyRound } from 'lucide-react'
import { presentAppError } from '@/lib/errors/presentation'
import { SettingsSection, SettingsSectionContent } from '@/app/settings/settings-page-layout'
import {
  emptyOwnerManagementSnapshot,
  formatDeviceDate,
  type EnrollmentInvitation,
  type OwnerManagementClient,
} from './owner-management-model'

function buildEnrollmentUrl(reference: string) {
  const url = new URL('/app/enroll', window.location.origin)
  url.searchParams.set('ref', reference)
  return url.toString()
}

export function OwnerManageScreen({ client }: { client: OwnerManagementClient }) {
  const [snapshot, setSnapshot] = useState(emptyOwnerManagementSnapshot)
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<EnrollmentInvitation | null>(null)
  const [invitationImage, setInvitationImage] = useState<string | null>(null)
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
      setError(presentAppError(cause, 'Unable to load Owner security state'))
    } finally {
      setSnapshotLoaded(true)
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true
    void client
      .getEnrollmentStatus()
      .then(async (current) => {
        if (!active || !current || Date.parse(current.expiresAt) <= Date.now()) return undefined
        const image = await QRCode.toDataURL(buildEnrollmentUrl(current.reference), {
          margin: 2,
          width: 240,
          errorCorrectionLevel: 'Q',
        })
        if (active) {
          setInvitation(current)
          setInvitationImage(image)
        }
        return undefined
      })
      .catch((cause) => {
        if (active) setError(presentAppError(cause, 'Unable to load enrollment status'))
        return undefined
      })
    return () => {
      active = false
    }
  }, [client])

  const act = async (key: string, operation: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await operation()
      await refresh()
    } catch (cause) {
      setError(presentAppError(cause, 'Operation failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6 text-foreground">
      <header>
        <p className="text-sm text-muted-foreground">Owner</p>
        <h2 className="text-2xl font-semibold">Security and devices</h2>
      </header>
      {error ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      ) : null}
      <SettingsSectionContent ready={snapshotLoaded} message="Loading security settings...">
        <div className="flex flex-col gap-16">
          <SettingsSection title="Passkeys">
            <div className="space-y-4">
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
            </div>
          </SettingsSection>
          <SettingsSection title="Add a device">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Create a short-lived invitation to add a remote browser to this Owner.
              </p>
              {invitation && invitationImage ? (
                <div className="flex flex-wrap items-start gap-4">
                  <img
                    src={invitationImage}
                    alt="Device enrollment QR code"
                    className="size-56 bg-white p-2"
                  />
                  <div className="space-y-2 text-sm">
                    <p>Expires {new Date(invitation.expiresAt).toLocaleTimeString()}</p>
                    <code className="block max-w-sm break-all text-xs">
                      {buildEnrollmentUrl(invitation.reference)}
                    </code>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard.writeText(buildEnrollmentUrl(invitation.reference))
                      }
                    >
                      <Copy className="size-4" /> Copy URL
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy === 'enrollment-cancel'}
                      onClick={() =>
                        void act('enrollment-cancel', async () => {
                          await client.cancelEnrollment()
                          setInvitation(null)
                          setInvitationImage(null)
                        })
                      }
                    >
                      Cancel invitation
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={busy === 'enrollment-issue'}
                  onClick={() =>
                    void act('enrollment-issue', async () => {
                      const issued = await client.issueEnrollment()
                      const url = buildEnrollmentUrl(issued.reference)
                      const image = await QRCode.toDataURL(url, {
                        margin: 2,
                        width: 240,
                        errorCorrectionLevel: 'Q',
                      })
                      setInvitation(issued)
                      setInvitationImage(image)
                    })
                  }
                >
                  Generate invitation
                </Button>
              )}
            </div>
          </SettingsSection>
          <SettingsSection title="Remote devices">
            <div className="space-y-3">
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
            </div>
          </SettingsSection>
        </div>
      </SettingsSectionContent>
    </div>
  )
}
