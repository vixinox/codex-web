import * as React from 'react'
import { useLocation, useNavigate } from 'react-router'
import { KeyRound, Loader2, QrCode, Laptop, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'
import {
  checkOwnerCodeAvailability,
  readKnownOwnerFingerprint,
  readOwnerCodePreference,
  rememberOwnerFingerprint,
  saveRecentOwnerTarget,
  type OwnerCodeAvailability,
} from '@/lib/remote/owner-code-preference'
import { createDeviceKey } from '@/lib/remote/device-key-store'
import {
  authenticateWithPasskey,
  authenticateWithRecoveryCode,
  redeemFirstSession,
} from '@/lib/remote/admission'
import { inspectRemoteOwnerFingerprint } from '@/lib/remote/admission'
import { LoginQrScanner, parseLoginQrPayload } from '@/app/owner/login-qr-scanner'
import type { FirstSessionPayload } from '@/app/owner/owner-management-model'
import { saveLocalOwnerSession } from '@/lib/auth/auth-client'
import {
  loadRemoteOwnerSession,
  loadDeviceKey,
  saveRemoteOwnerSession,
  setPairedDevice,
} from '@/lib/remote/device-key-store'

export function LoginScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = React.useState<'local' | 'remote'>('local')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showScanner, setShowScanner] = React.useState(false)
  const [manualPayload, setManualPayload] = React.useState('')
  const [relayUrl, setRelayUrl] = React.useState(readOwnerCodePreference().target?.relayUrl ?? '')
  const [ownerCode, setOwnerCode] = React.useState(readOwnerCodePreference().ownerCode)
  const [availability, setAvailability] = React.useState<OwnerCodeAvailability>('idle')
  const [target, setTarget] = React.useState<{ nodeId: string; trustEpoch: number } | null>(null)
  const [fingerprint, setFingerprint] = React.useState('')

  React.useEffect(() => {
    const reference = new URLSearchParams(location.search).get('ref')
    if (!reference || !/^[A-Za-z0-9_-]{16,256}$/u.test(reference)) return
    const url = new URL('/app/first-session', window.location.origin)
    url.searchParams.set('ref', reference)
    setManualPayload(url.toString())
    setMode('remote')
  }, [location.search])
  const [verifiedFingerprint, setVerifiedFingerprint] = React.useState<string | null>(null)
  const [presence, setPresence] = React.useState<{
    remotePasskey: boolean
    recovery: boolean
  } | null>(null)
  const [recoveryCode, setRecoveryCode] = React.useState('')
  const [showSecurityPrompt, setShowSecurityPrompt] = React.useState(false)

  React.useEffect(() => {
    let active = true
    void (async () => {
      const device = await loadDeviceKey()
      if (
        !device?.pairedClientToken ||
        !device.deviceId ||
        !device.nodeId ||
        !device.relayUrl ||
        !device.ownerCode
      )
        return
      const session = await loadRemoteOwnerSession({
        relayUrl: device.relayUrl,
        ownerCode: device.ownerCode,
        nodeId: device.nodeId,
        deviceId: device.deviceId,
        ownerId: device.ownerId ?? undefined,
      })
      if (active && session)
        await navigate('/app', { replace: true, state: { remoteOwnerId: session.ownerId } })
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [navigate])

  React.useEffect(() => {
    if (mode !== 'remote' || ownerCode.length !== 9 || !relayUrl) return
    let active = true
    setAvailability('checking')
    const timer = window.setTimeout(() => {
      void checkOwnerCodeAvailability({ relayUrl, ownerCode }).then((result) => {
        if (!active) return
        setAvailability(result.status)
        setTarget(
          result.status === 'online'
            ? { nodeId: result.nodeId, trustEpoch: result.trustEpoch }
            : null,
        )
      })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [mode, ownerCode, relayUrl])

  React.useEffect(() => {
    if (!target) return
    const saved = readKnownOwnerFingerprint(relayUrl, target.nodeId)
    setFingerprint(saved ?? '')
    setVerifiedFingerprint(null)
    setPresence(null)
  }, [relayUrl, target])

  const connectRemoteCandidate = async (options: {
    relayUrl: string
    ownerCode: string
    nodeId: string
    trustEpoch: number
    expectedFingerprint: string
  }) => {
    const record = await loadDeviceKey()
    if (!record) await createDeviceKey()
    const device = await loadDeviceKey()
    if (!device) throw new Error('Unable to create a remote device key.')
    const targetSocket = {
      nodeId: options.nodeId,
      trustEpoch: options.trustEpoch,
      clientToken: '',
      publicKey: device.publicKey,
      privateKey: device.privateKey,
      loginOwnerCode: options.ownerCode,
      expectedOwnerFingerprint: options.expectedFingerprint,
    }
    const { createRelayOwnerSocket } = await import('@/lib/remote/relay-owner-socket')
    const relaySocket = createRelayOwnerSocket(options.relayUrl, targetSocket)
    const candidate = createOwnerRuntime(() => relaySocket)
    await candidate.connect({
      url: options.relayUrl,
      clientId: 'owner-login-candidate',
      capabilities: ['owner'],
    })
    return candidate
  }

  const inspectRemotePresence = async (
    owner: { nodeId: string; trustEpoch: number },
    fingerprint: string,
  ) => {
    const runtime = await connectRemoteCandidate({
      relayUrl,
      ownerCode,
      nodeId: owner.nodeId,
      trustEpoch: owner.trustEpoch,
      expectedFingerprint: fingerprint,
    })
    try {
      const status = await runtime.request<{
        remotePasskeyAvailable?: boolean
        recoveryAvailable?: boolean
      }>('owner.status')
      setPresence({
        remotePasskey: status.remotePasskeyAvailable === true,
        recovery: status.recoveryAvailable === true,
      })
    } finally {
      runtime.close('presence checked')
    }
  }

  const finishRemote = async (payload: FirstSessionPayload) => {
    const result = await redeemFirstSession(payload)
    saveRecentOwnerTarget({
      relayUrl: payload.relayUrl,
      ownerCode: result.ownerCode,
      nodeId: result.nodeId,
    })
    await navigate('/app', {
      replace: true,
      state: { remoteOwnerId: result.ownerId, firstSession: true },
    })
    setShowSecurityPrompt(true)
  }

  const signInPasskey = async () => {
    if (!target || !verifiedFingerprint) throw new Error('Verify the Owner fingerprint first.')
    const runtime = await connectRemoteCandidate({
      relayUrl,
      ownerCode,
      nodeId: target.nodeId,
      trustEpoch: target.trustEpoch,
      expectedFingerprint: verifiedFingerprint,
    })
    try {
      const result = await authenticateWithPasskey(runtime, 'remote')
      saveRecentOwnerTarget({ relayUrl, ownerCode, nodeId: target.nodeId })
      await navigate('/app', { replace: true, state: { remoteOwnerId: result.ownerId } })
    } finally {
      runtime.close('passkey sign-in complete')
    }
  }

  const signInRecovery = async () => {
    if (!target || !verifiedFingerprint) throw new Error('Verify the Owner fingerprint first.')
    const runtime = await connectRemoteCandidate({
      relayUrl,
      ownerCode,
      nodeId: target.nodeId,
      trustEpoch: target.trustEpoch,
      expectedFingerprint: verifiedFingerprint,
    })
    try {
      const result = await authenticateWithRecoveryCode(runtime, recoveryCode.trim())
      const device = await loadDeviceKey()
      if (!device) throw new Error('Remote device key is unavailable.')
      await setPairedDevice({
        deviceId: result.deviceId,
        pairedClientToken: result.clientToken,
        trustEpoch: result.trustEpoch,
        nodeId: target.nodeId,
        relayUrl,
      })
      await saveRemoteOwnerSession({
        token: result.sessionToken,
        expiresAt: result.expiresAt,
        relayUrl,
        ownerCode,
        nodeId: target.nodeId,
        deviceId: result.deviceId,
        ownerId: result.ownerId,
      })
      saveRecentOwnerTarget({ relayUrl, ownerCode, nodeId: target.nodeId })
      await navigate('/app', {
        replace: true,
        state: {
          remoteOwnerId: result.ownerId!,
          recovered: true,
          recoveryCodes: result.recoveryCodes,
        },
      })
    } finally {
      runtime.close('recovery sign-in complete')
    }
  }

  const signInLocal = async () => {
    const runtime = createOwnerRuntime()
    await runtime.connect({
      url: `${window.location.origin.replace(/^http/, 'ws')}/ws`,
      clientId: 'owner-local-login',
      capabilities: ['owner'],
    })
    const result = await authenticateWithPasskey(runtime, 'local')
    if (!result.ownerId) throw new Error('Owner identity is unavailable.')
    saveLocalOwnerSession({
      token: result.token!,
      ownerId: result.ownerId,
      expiresAt: result.expiresAt,
    })
    runtime.close('local passkey sign-in complete')
    await navigate('/app', { replace: true })
  }

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-md space-y-5">
        <header>
          <p className="text-sm text-muted-foreground">Codex Web</p>
          <h1 className="text-2xl font-semibold">Connect to Owner</h1>
        </header>
        {showSecurityPrompt ? (
          <div role="status" className="rounded-md border p-3 text-sm">
            First connection complete. You can set up Passkey and recovery codes later in{' '}
            <a className="underline" href="/app/owner">
              Owner security settings
            </a>
            .
            <Button
              className="ml-2"
              size="sm"
              variant="ghost"
              onClick={() => setShowSecurityPrompt(false)}
            >
              Continue
            </Button>
          </div>
        ) : null}
        <div className="inline-flex border-b border-border">
          <Button
            variant={mode === 'local' ? 'secondary' : 'ghost'}
            onClick={() => setMode('local')}
          >
            <Laptop className="size-4" /> This machine
          </Button>
          <Button
            variant={mode === 'remote' ? 'secondary' : 'ghost'}
            onClick={() => setMode('remote')}
          >
            <Radio className="size-4" /> Remote
          </Button>
        </div>
        <Card className="border-border bg-card">
          <CardContent className="space-y-4 p-5">
            {mode === 'local' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Sign in with a Passkey registered for localhost.
                </p>
                <Button className="w-full" disabled={busy} onClick={() => void run(signInLocal)}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <KeyRound className="size-4" />
                  )}
                  Use local Passkey
                </Button>
              </>
            ) : (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="relay-url">Relay URL</FieldLabel>
                  <Input
                    id="relay-url"
                    value={relayUrl}
                    onChange={(event) => setRelayUrl(event.target.value)}
                    placeholder="wss://relay.vixinox.com/ws"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="owner-code">Owner code</FieldLabel>
                  <Input
                    id="owner-code"
                    inputMode="numeric"
                    maxLength={9}
                    value={ownerCode}
                    onChange={(event) =>
                      setOwnerCode(event.target.value.replace(/\D/gu, '').slice(0, 9))
                    }
                  />
                  <p className="text-xs text-muted-foreground" role="status">
                    {availability === 'online'
                      ? 'Owner online'
                      : availability === 'checking'
                        ? 'Checking Owner'
                        : availability === 'offline'
                          ? 'Owner offline'
                          : availability === 'unreachable'
                            ? 'Relay unreachable'
                            : ''}
                  </p>
                </Field>
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button variant="outline" disabled={busy} onClick={() => setShowScanner(true)}>
                    <QrCode className="size-4" /> First-session QR
                  </Button>
                  <Input
                    value={manualPayload}
                    onChange={(event) => setManualPayload(event.target.value)}
                    placeholder="Paste first-session URL"
                    aria-label="First-session URL"
                  />
                  <Button
                    variant="outline"
                    disabled={busy || !manualPayload}
                    onClick={() =>
                      void run(async () => finishRemote(parseLoginQrPayload(manualPayload)))
                    }
                  >
                    Connect
                  </Button>
                </div>
                {target ? (
                  <Field>
                    <FieldLabel htmlFor="fingerprint">Owner fingerprint</FieldLabel>
                    <Input
                      id="fingerprint"
                      value={fingerprint}
                      onChange={(event) => {
                        setFingerprint(event.target.value)
                        setVerifiedFingerprint(null)
                      }}
                      spellCheck={false}
                    />
                    <Button
                      variant="outline"
                      disabled={busy || !fingerprint}
                      onClick={() =>
                        void run(async () => {
                          const actual = await inspectRemoteOwnerFingerprint({
                            relayUrl,
                            ownerCode,
                            nodeId: target.nodeId,
                            trustEpoch: target.trustEpoch,
                          })
                          if (actual !== fingerprint) throw new Error('Owner fingerprint mismatch.')
                          rememberOwnerFingerprint(relayUrl, target.nodeId, actual)
                          setVerifiedFingerprint(actual)
                          await inspectRemotePresence(target, actual)
                        })
                      }
                    >
                      Verify fingerprint
                    </Button>
                  </Field>
                ) : null}
                {verifiedFingerprint ? (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    {presence?.remotePasskey ? (
                      <Button disabled={busy} onClick={() => void run(signInPasskey)}>
                        <KeyRound className="size-4" /> Passkey
                      </Button>
                    ) : null}
                    {presence?.recovery ? (
                      <div className="w-full space-y-2">
                        <Input
                          aria-label="Recovery code"
                          value={recoveryCode}
                          onChange={(event) => setRecoveryCode(event.target.value)}
                          placeholder="Recovery code"
                        />
                        <Button
                          variant="outline"
                          disabled={busy || !recoveryCode.trim()}
                          onClick={() => void run(signInRecovery)}
                        >
                          Use recovery code and register a new Passkey
                        </Button>
                      </div>
                    ) : null}
                    {!presence?.remotePasskey && !presence?.recovery ? (
                      <p className="w-full text-xs text-muted-foreground">
                        If no first-session QR is available, generate a new bootstrap URL on the
                        Owner machine.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </FieldGroup>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      {showScanner ? (
        <LoginQrScanner
          onClose={() => setShowScanner(false)}
          onRedeem={(payload) => finishRemote(payload)}
        />
      ) : null}
    </main>
  )
}
