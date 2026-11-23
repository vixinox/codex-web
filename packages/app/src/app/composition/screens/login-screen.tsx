import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Loader2, LogOut, Radio, Trash2, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'
import { authenticateWithPasskey, redeemEnrollmentOnce } from '@/lib/remote/admission'
import {
  clearConnectionProfileSession,
  listConnectionProfiles,
  loadConnectionProfile,
  loadConnectionProfileSession,
  removeConnectionProfile,
  saveConnectionProfileSession,
  updateConnectionProfileLastConnected,
  type ConnectionProfileSummary,
} from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'
import { presentAppError } from '@/lib/errors/presentation'
import { ownerTargetKind } from '@/lib/owner-ws/target'

export function LoginScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const isLocal = ownerTargetKind(window.location.origin) === 'local'
  const [profiles, setProfiles] = React.useState<ConnectionProfileSummary[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [statuses, setStatuses] = React.useState<Record<string, string>>({})
  const hasLoginLink =
    location.pathname === '/app/enroll' || new URLSearchParams(location.search).has('ref')
  const next = new URLSearchParams(location.search).get('next')
  const [loginAttempt, setLoginAttempt] = React.useState(0)

  const refreshProfiles = React.useCallback(async () => {
    setProfiles(await listConnectionProfiles())
  }, [])

  React.useEffect(() => {
    if (isLocal || hasLoginLink) return
    void refreshProfiles().catch((cause) =>
      setError(presentAppError(cause, 'Unable to read saved connections')),
    )
  }, [isLocal, hasLoginLink, refreshProfiles])

  React.useEffect(() => {
    if (!hasLoginLink) {
      setError(null)
      setBusy(null)
      return undefined
    }
    let active = true
    const params = new URLSearchParams(location.search)
    const reference = params.get('ref')
    setError(null)
    if (
      !reference ||
      !/^[A-Za-z0-9_-]{16,256}$/u.test(reference) ||
      [...params.keys()].some((key) => !['ref', 'next'].includes(key)) ||
      (params.has('next') && params.get('next') !== 'connection')
    ) {
      setError('This login link is invalid. Generate a new link from the Owner.')
      setBusy(null)
      return undefined
    }
    setBusy('link')
    void redeemEnrollmentOnce(reference)
      .then(async (result) => {
        if (!active) return undefined
        sessionStorage.setItem('codex-web:active-connection-profile', result.profileId)
        const target =
          next === 'connection'
            ? '/app/settings/connection'
            : `/app?connection=${encodeURIComponent(result.profileId)}`
        await navigate(target, {
          replace: true,
          state: { connectionProfileId: result.profileId },
        })
        return undefined
      })
      .catch((cause) => {
        if (active)
          setError(
            presentAppError(cause, 'One-time login failed. Generate a new link or try again.'),
          )
      })
      .finally(() => {
        if (active) setBusy(null)
      })
    return () => {
      active = false
    }
  }, [hasLoginLink, location.search, loginAttempt, navigate, next])

  const connectProfile = async (id: string, testOnly: boolean) => {
    const profile = await loadConnectionProfile(id)
    if (!profile?.deviceId || !profile.pairedClientToken || profile.trustEpoch === null)
      throw new Error('This connection needs a new Owner-issued login link.')
    const savedSession = await loadConnectionProfileSession(id)
    const socketTarget = {
      nodeId: profile.nodeId,
      trustEpoch: profile.trustEpoch,
      clientToken: profile.pairedClientToken,
      deviceId: profile.deviceId,
      publicKey: profile.publicKey,
      privateKey: profile.privateKey,
      expectedOwnerPublicKey: profile.ownerPublicKey,
    }
    const runtime = createOwnerRuntime(() => createRelayOwnerSocket(profile.relayUrl, socketTarget))
    try {
      await runtime.connect({
        url: profile.relayUrl,
        ...(savedSession ? { sessionToken: savedSession.token } : {}),
        clientId: 'owner-remote-login',
        capabilities: ['owner'],
      })
      if (!runtime.authenticated) {
        if (testOnly)
          throw new Error(
            savedSession
              ? 'Owner is reachable, but the session needs re-authentication.'
              : 'Owner is reachable, but this profile has no active session.',
          )
        const result = await authenticateWithPasskey(runtime)
        if (!result.ownerId || result.ownerId !== profile.ownerId)
          throw new Error('Owner identity does not match this saved connection.')
        await saveConnectionProfileSession(id, {
          token: result.token,
          expiresAt: result.expiresAt,
        })
        await updateConnectionProfileLastConnected(id)
        sessionStorage.setItem('codex-web:active-connection-profile', id)
        await navigate(`/app?connection=${encodeURIComponent(id)}`, {
          replace: true,
          state: { remoteOwnerId: profile.ownerId, connectionProfileId: id },
        })
        return
      }
      if (testOnly) {
        setStatuses((current) => ({ ...current, [id]: 'Connected' }))
        return
      }
      const session = await loadConnectionProfileSession(id)
      if (!session) throw new Error('The saved session expired. Use a new Owner-issued login link.')
      await updateConnectionProfileLastConnected(id)
      sessionStorage.setItem('codex-web:active-connection-profile', id)
      await navigate(`/app?connection=${encodeURIComponent(id)}`, {
        replace: true,
        state: { remoteOwnerId: profile.ownerId, connectionProfileId: id },
      })
    } finally {
      runtime.close(testOnly ? 'connection test complete' : 'remote login complete')
    }
  }

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (cause) {
      const message = presentAppError(cause, 'Connection failed')
      setError(message)
      if (key.startsWith('test:'))
        setStatuses((current) => ({ ...current, [key.slice(5)]: message }))
    } finally {
      setBusy(null)
    }
  }

  const removeProfile = async (id: string) => {
    const profile = await loadConnectionProfile(id)
    if (profile?.deviceId && profile.pairedClientToken && profile.trustEpoch !== null) {
      const session = await loadConnectionProfileSession(id)
      if (session) {
        const target = {
          nodeId: profile.nodeId,
          trustEpoch: profile.trustEpoch,
          clientToken: profile.pairedClientToken,
          deviceId: profile.deviceId,
          publicKey: profile.publicKey,
          privateKey: profile.privateKey,
          expectedOwnerPublicKey: profile.ownerPublicKey,
        }
        const runtime = createOwnerRuntime(() => createRelayOwnerSocket(profile.relayUrl, target))
        try {
          await runtime.connect({
            url: profile.relayUrl,
            sessionToken: session.token,
            clientId: 'owner-connection-removal',
            capabilities: ['owner'],
          })
          await runtime.request('remote.devices.revoke', { deviceId: profile.deviceId })
        } catch {
          // Local secrets are removed even when Owner cannot be reached.
        } finally {
          runtime.close('connection removed')
        }
      }
    }
    await removeConnectionProfile(id)
    await refreshProfiles()
  }

  return (
    <main className="min-h-svh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-xl space-y-5">
        <header>
          <p className="text-sm text-muted-foreground">Codex Web</p>
          <h1 className="text-2xl font-semibold">
            {isLocal ? 'Sign in to this Owner' : 'Remote connections'}
          </h1>
        </header>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {hasLoginLink ? (
          <div className="flex flex-col gap-3">
            {busy === 'link' || !error ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Signing in…
              </p>
            ) : (
              <div className="flex gap-2">
                <Button onClick={() => setLoginAttempt((attempt) => attempt + 1)}>Try again</Button>
                <Button variant="ghost" onClick={() => void navigate('/login', { replace: true })}>
                  Back to login
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.length ? (
              profiles.map((profile) => (
                <Card key={profile.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-medium">
                        {profile.label || 'Owner connection'}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {profile.lastConnectedAt
                          ? `Last connected ${new Date(profile.lastConnectedAt).toLocaleString()}`
                          : 'Not connected yet'}
                        {statuses[profile.id] ? ` · ${statuses[profile.id]}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`test:${profile.id}`, () => connectProfile(profile.id, true))
                        }
                      >
                        {busy === `test:${profile.id}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Wifi className="size-4" />
                        )}
                        Test
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy !== null || !profile.paired}
                        onClick={() =>
                          void run(`connect:${profile.id}`, () => connectProfile(profile.id, false))
                        }
                      >
                        {busy === `connect:${profile.id}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Radio className="size-4" />
                        )}
                        Connect
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null || !profile.hasSession}
                        onClick={() =>
                          void run(`logout:${profile.id}`, async () => {
                            await clearConnectionProfileSession(profile.id)
                            if (
                              sessionStorage.getItem('codex-web:active-connection-profile') ===
                              profile.id
                            )
                              sessionStorage.removeItem('codex-web:active-connection-profile')
                            await refreshProfiles()
                          })
                        }
                      >
                        <LogOut className="size-4" /> Log out
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${profile.label}`}
                        title="Remove connection"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`remove:${profile.id}`, () => removeProfile(profile.id))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {!profile.hasSession ? (
                      <p className="w-full text-xs text-muted-foreground">
                        Use a Passkey or a new Owner-issued login link to sign in again.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="border-y py-8 text-center">
                <p className="font-medium">No saved connections</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open a one-time login link issued by the Owner.
                </p>
              </div>
            )}
            <p className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <Radio className="size-3.5" /> Connection profiles are stored in this browser.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
