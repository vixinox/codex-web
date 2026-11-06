import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { KeyRound, Loader2, LogOut, Plus, Radio, Trash2, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'
import { authenticateWithPasskey } from '@/lib/remote/admission'
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

export function LoginScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const isLocal = window.location.hostname === 'localhost'
  const [profiles, setProfiles] = React.useState<ConnectionProfileSummary[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [statuses, setStatuses] = React.useState<Record<string, string>>({})
  const enrollmentReference = new URLSearchParams(location.search).get('ref')

  const refreshProfiles = React.useCallback(async () => {
    setProfiles(await listConnectionProfiles())
  }, [])

  React.useEffect(() => {
    if (isLocal) return
    void refreshProfiles().catch((cause) =>
      setError(presentAppError(cause, 'Unable to read saved connections')),
    )
  }, [isLocal, refreshProfiles])

  const connectProfile = async (id: string, testOnly: boolean) => {
    const profile = await loadConnectionProfile(id)
    if (!profile?.deviceId || !profile.pairedClientToken || profile.trustEpoch === null)
      throw new Error('This connection needs a new enrollment invitation.')
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
        const result = await authenticateWithPasskey(runtime, 'remote')
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
      if (!session) throw new Error('The saved session expired. Use a new enrollment invitation.')
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

  const signInLocal = async () => {
    const runtime = createOwnerRuntime()
    try {
      await runtime.connect({
        url: `${window.location.origin.replace(/^http/u, 'ws')}/ws`,
        clientId: 'owner-local-login',
        capabilities: ['owner'],
      })
      const result = await authenticateWithPasskey(runtime, 'local')
      if (!result.ownerId || !result.token || !result.expiresAt)
        throw new Error('Owner identity is unavailable.')
      const { saveLocalOwnerSession } = await import('@/lib/auth/auth-client')
      saveLocalOwnerSession({
        token: result.token,
        ownerId: result.ownerId,
        expiresAt: result.expiresAt,
      })
      await navigate('/app', { replace: true })
    } finally {
      runtime.close('local Passkey sign-in complete')
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
        {isLocal ? (
          <Card>
            <CardContent className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                Use a Passkey registered for localhost.
              </p>
              <Button
                className="w-full"
                disabled={busy !== null}
                onClick={() => void run('local', signInLocal)}
              >
                {busy === 'local' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <KeyRound className="size-4" />
                )}
                Use local Passkey
              </Button>
            </CardContent>
          </Card>
        ) : enrollmentReference ? (
          <Card>
            <CardContent className="space-y-3 p-5">
              <h2 className="font-medium">Adding this browser</h2>
              <p className="text-sm text-muted-foreground">
                The Owner-issued invitation will register this browser and save a remote connection.
              </p>
              <Button
                onClick={() =>
                  void navigate(`/app/enroll?ref=${encodeURIComponent(enrollmentReference)}`, {
                    replace: true,
                  })
                }
              >
                <Plus className="size-4" /> Continue enrollment
              </Button>
            </CardContent>
          </Card>
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
                        Session unavailable. Use a new enrollment invitation.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            ) : (
              <div className="border-y py-8 text-center">
                <p className="font-medium">No saved connections</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open an enrollment link issued by the Owner.
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
