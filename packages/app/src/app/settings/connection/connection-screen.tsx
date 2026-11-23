import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, KeyRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Separator } from '@/components/ui/separator'
import { OwnerConnectionError } from '@/lib/owner-ws/owner-runtime'
import { presentAppError } from '@/lib/errors/presentation'
import { SettingsSection, SettingsSectionContent } from '@/app/settings/settings-page-layout'
import {
  emptyConnectionSnapshot,
  formatDeviceDate,
  type EnrollmentInvitation,
  type ConnectionClient,
  type ConnectionSnapshot,
} from './connection-model'
import { ownerTargetKind } from '@/lib/owner-ws/target'

function enrollmentUrl(reference: string, appOrigin: string, next?: 'connection') {
  const url = new URL('/app/enroll', appOrigin)
  url.searchParams.set('ref', reference)
  if (next) url.searchParams.set('next', next)
  return url.toString()
}

export function ConnectionScreen({ client }: { client: ConnectionClient }) {
  const [data, setData] = useState<{
    snapshot: ConnectionSnapshot
    invitation: (EnrollmentInvitation & { image: string }) | null
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [confirmation, setConfirmation] = useState<{ id: string } | 'all' | null>(null)
  const [enrollment, setEnrollment] = useState<{
    reference: string
    appOrigin: string
    expiresAt: string
  } | null>(null)
  const current = useRef(data)
  const pending = useRef(false)
  const local = ownerTargetKind(window.location.origin) === 'local'

  useEffect(() => {
    let active = true
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const [snapshot, invitation] = await Promise.all([
          client.getSnapshot(),
          client.getEnrollmentStatus(),
        ])
        const image = invitation
          ? current.current?.invitation?.reference === invitation.reference
            ? current.current.invitation.image
            : await QRCode.toDataURL(enrollmentUrl(invitation.reference, invitation.appOrigin), {
                margin: 2,
                width: 240,
                errorCorrectionLevel: 'Q',
              })
          : null
        if (active) {
          current.current = {
            snapshot,
            invitation: invitation && image ? { ...invitation, image } : null,
          }
          setData(current.current)
        }
      } catch (cause) {
        if (active) setError(presentAppError(cause, 'Unable to load connection settings'))
      } finally {
        loading = false
      }
    }
    const poll = () => {
      if (!document.hidden && !pending.current && current.current?.invitation) void load()
    }
    void load()
    const timer = window.setInterval(poll, 3_000)
    document.addEventListener('visibilitychange', poll)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [client, revision])

  const refresh = () => {
    setError(null)
    setRevision((value) => value + 1)
  }
  const act = async (operation: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      if (!(cause instanceof OwnerConnectionError && cause.closeReason === 'device_revoked'))
        setError(presentAppError(cause, 'Operation failed'))
    } finally {
      pending.current = false
      setBusy(false)
      setRevision((value) => value + 1)
    }
  }
  const snapshot = data?.snapshot ?? emptyConnectionSnapshot()
  const invitation = data?.invitation
  const image = invitation?.image

  const removeConfirmed = () => {
    const selected = confirmation
    setConfirmation(null)
    if (!selected) return
    void act(async () => {
      if (selected === 'all') await client.revokeAllDevices()
      else await client.revokeDevice(selected.id)
    })
  }

  return (
    <SettingsSection title="Connection" headingLevel={1}>
      <SettingsSectionContent
        state={data ? 'ready' : error ? 'error' : 'loading'}
        message="Loading connection settings..."
        error={
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refresh()
              }}
            >
              Retry
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-12">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <SettingsSection title="Passkeys">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 border-b pb-3">
                <span>Passkey · {snapshot.appOrigin ?? 'Remote access unavailable'}</span>
                <Badge variant={snapshot.passkeyAvailable ? 'default' : 'secondary'}>
                  {snapshot.passkeyAvailable ? 'Configured' : 'Not configured'}
                </Badge>
              </div>
              {!snapshot.passkeyAvailable ? (
                local ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {snapshot.appOrigin
                        ? 'The link opens the remote website. Creating it replaces the current pending sign-in link.'
                        : 'Remote access is not configured. Set up CODEX_APP_ORIGIN and Relay to create a Passkey.'}
                    </p>
                    <Button
                      disabled={busy || !snapshot.appOrigin}
                      onClick={() =>
                        void act(async () => {
                          const issuedInvitation = await client.issueEnrollment()
                          const url = enrollmentUrl(
                            issuedInvitation.reference,
                            issuedInvitation.appOrigin,
                            'connection',
                          )
                          const opened = window.open(url, '_blank', 'noopener,noreferrer')
                          if (!opened) setEnrollment(issuedInvitation)
                        })
                      }
                    >
                      <KeyRound data-icon="inline-start" /> Set up Passkey
                    </Button>
                    {enrollment ? (
                      <a
                        className="break-all text-sm underline"
                        href={enrollmentUrl(
                          enrollment.reference,
                          enrollment.appOrigin,
                          'connection',
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open remote Passkey setup
                      </a>
                    ) : null}
                  </>
                ) : (
                  <Button disabled={busy} onClick={() => void act(() => client.registerPasskey())}>
                    <KeyRound data-icon="inline-start" /> Create Passkey
                  </Button>
                )
              ) : null}
            </div>
          </SettingsSection>
          <SettingsSection title="Sign-in link">
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Scan the code in another browser, or send it the link. Each link signs in once and
                expires after five minutes; a browser used before keeps its device identity.
              </p>
              {invitation ? (
                <div className="flex flex-wrap items-start gap-5">
                  {image ? (
                    <img src={image} alt="Scan to sign in" className="size-56 bg-white p-2" />
                  ) : (
                    <p role="status">Preparing code...</p>
                  )}
                  <div className="flex flex-col items-start gap-3">
                    <p className="text-sm text-muted-foreground">
                      Expires {new Date(invitation.expiresAt).toLocaleTimeString()}
                    </p>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          navigator.clipboard.writeText(
                            enrollmentUrl(invitation.reference, invitation.appOrigin),
                          ),
                        )
                      }
                    >
                      <Copy data-icon="inline-start" /> Copy link
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await client.cancelEnrollment()
                        })
                      }
                    >
                      Cancel link
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="self-start"
                  disabled={busy}
                  onClick={() => void act(() => client.issueEnrollment())}
                >
                  Create sign-in link
                </Button>
              )}
            </div>
          </SettingsSection>
          <SettingsSection title="Remote devices">
            <div className="flex flex-col gap-4">
              {snapshot.devices.length ? (
                snapshot.devices.map((device) => (
                  <div
                    key={device.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 last:border-0"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-all font-medium">{device.id}</p>
                        {snapshot.currentDeviceId === device.id ? (
                          <Badge variant="secondary">This device</Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Last used {formatDeviceDate(device.lastSeenAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmation({ id: device.id })}
                    >
                      Remove
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No remote devices. Add one to access this computer remotely.
                </p>
              )}
            </div>
          </SettingsSection>
          <Separator />
          <SettingsSection title="Remove all remote devices">
            <div className="flex flex-col items-start gap-4">
              <p className="text-sm text-muted-foreground">
                Disconnect every remote device, including this one if you are connected remotely.
                Sign in again using the CLI on the computer running Codex Web.
              </p>
              <Button
                variant="destructive"
                disabled={busy || snapshot.devices.length === 0}
                onClick={() => setConfirmation('all')}
              >
                Remove all remote devices
              </Button>
            </div>
          </SettingsSection>
        </div>
      </SettingsSectionContent>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === 'all' ? 'Remove all remote devices?' : 'Remove this device?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === 'all'
                ? 'All remote devices will lose access, including this browser if connected remotely. Use the CLI on the computer running Codex Web to sign in again.'
                : confirmation?.id === snapshot.currentDeviceId
                  ? 'This browser will lose access and return to login. You will need a new sign-in link to use it again.'
                  : 'This device will lose access immediately. A new sign-in link is required to use it again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removeConfirmed}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
