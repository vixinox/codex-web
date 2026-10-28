import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Copy } from 'lucide-react'
import {
  emptyOwnerManagementSnapshot,
  formatDeviceDate,
  type OwnerManagementClient,
  type IssuedLoginQr,
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
  const [totpQrCode, setTotpQrCode] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [codesAcknowledged, setCodesAcknowledged] = useState(false)
  const [loginQr, setLoginQr] = useState<IssuedLoginQr | null>(null)
  const [loginQrImage, setLoginQrImage] = useState<string | null>(null)
  const [loginQrRemaining, setLoginQrRemaining] = useState(0)
  const [loginQrState, setLoginQrState] = useState<
    'none' | 'active' | 'consumed' | 'expired' | 'cancelled' | 'restarted' | 'failed'
  >('none')
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
  useEffect(() => {
    let active = true
    void client
      .loginQrStatus()
      .then((result) => {
        if (!active) return undefined
        if (result.state !== 'none') {
          setLoginQrState(result.state)
          return undefined
        }
        const oldExpiry = Number(sessionStorage.getItem('owner-login-qr-expires-at'))
        if (oldExpiry > Date.now()) setLoginQrState('restarted')
        sessionStorage.removeItem('owner-login-qr-expires-at')
        return undefined
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [client])
  useEffect(() => {
    if (!loginQr) return undefined
    let active = true
    const expiresAt = Date.parse(loginQr.expiresAt)
    const update = () => {
      if (!active) return
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      setLoginQrRemaining(remaining)
      if (!remaining) {
        setLoginQrState('expired')
        setLoginQr(null)
        setLoginQrImage(null)
        sessionStorage.removeItem('owner-login-qr-expires-at')
      }
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [loginQr])
  useEffect(() => {
    if (!loginQr) return undefined
    let active = true
    const check = async () => {
      try {
        const result = await client.loginQrStatus()
        if (!active || result.state === 'active') return
        setLoginQrState(result.state === 'none' ? 'restarted' : result.state)
        setLoginQr(null)
        setLoginQrImage(null)
        sessionStorage.removeItem('owner-login-qr-expires-at')
      } catch {
        // Transport status is presented by the shared management state above.
      }
    }
    const timer = window.setInterval(() => void check(), 3000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [client, loginQr])
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
            <CardTitle>One-time device login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Anyone who scans this QR can sign in to this Owner for five minutes. Treat it as a
              temporary login credential.
            </p>
            {loginQr && loginQrImage ? (
              <div className="flex flex-wrap items-start gap-4">
                <img
                  src={loginQrImage}
                  alt="One-time Owner login QR code"
                  className="size-56 bg-white p-2"
                />
                <div className="space-y-2 text-sm">
                  <p role="status">
                    Active · {Math.floor(loginQrRemaining / 60)}:
                    {String(loginQrRemaining % 60).padStart(2, '0')} remaining
                  </p>
                  <p>
                    Owner {loginQr.payload.ownerCode} · {loginQr.payload.nodeId}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    Owner key fingerprint: {loginQr.payload.ownerPublicKeyFingerprint}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void navigator.clipboard.writeText(loginQr.payload.ownerPublicKeyFingerprint)
                    }
                  >
                    <Copy className="size-4" /> Copy fingerprint
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy === 'login-qr-cancel'}
                    onClick={() =>
                      void act('login-qr-cancel', async () => {
                        await client.cancelLoginQr()
                        setLoginQr(null)
                        setLoginQrImage(null)
                        setLoginQrState('cancelled')
                        sessionStorage.removeItem('owner-login-qr-expires-at')
                      })
                    }
                  >
                    Cancel QR
                  </Button>
                </div>
              </div>
            ) : null}
            {!loginQr ? (
              <Button
                type="button"
                disabled={busy === 'login-qr-issue'}
                onClick={() =>
                  void act('login-qr-issue', async () => {
                    try {
                      const issued = await client.issueLoginQr()
                      const image = await QRCode.toDataURL(JSON.stringify(issued.payload), {
                        margin: 2,
                        width: 280,
                        errorCorrectionLevel: 'Q',
                      })
                      setLoginQr(issued)
                      setLoginQrImage(image)
                      setLoginQrState('active')
                      sessionStorage.setItem(
                        'owner-login-qr-expires-at',
                        String(Date.parse(issued.expiresAt)),
                      )
                    } catch (cause) {
                      await client.cancelLoginQr().catch(() => undefined)
                      setLoginQrState('failed')
                      sessionStorage.removeItem('owner-login-qr-expires-at')
                      throw cause
                    }
                  })
                }
              >
                Generate login QR
              </Button>
            ) : null}
            {!loginQr && loginQrState !== 'none' ? (
              <p role="status" className="text-xs text-muted-foreground">
                {loginQrState === 'expired'
                  ? 'QR expired.'
                  : loginQrState === 'cancelled'
                    ? 'QR cancelled.'
                    : loginQrState === 'consumed'
                      ? 'QR used.'
                      : loginQrState === 'restarted'
                        ? 'QR invalidated after Owner restart.'
                        : loginQrState === 'failed'
                          ? 'QR could not be issued. Try again.'
                          : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
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
                  setTotpQrCode(
                    result.totpURI
                      ? await QRCode.toDataURL(result.totpURI, {
                          margin: 2,
                          width: 240,
                          errorCorrectionLevel: 'M',
                        })
                      : null,
                  )
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
              <div className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-start gap-4">
                  {totpQrCode ? (
                    <img
                      src={totpQrCode}
                      alt="Scan this QR code with your authenticator app"
                      className="size-60 rounded bg-white p-2"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm font-medium">Scan with your authenticator app</p>
                    <p className="text-xs text-muted-foreground">
                      If scanning is unavailable, copy the setup URI into your authenticator app.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void navigator.clipboard.writeText(totpUri)}
                      >
                        Copy setup URI
                      </Button>
                    </div>
                    <code className="block max-h-20 overflow-auto break-all text-xs text-muted-foreground">
                      {totpUri}
                    </code>
                  </div>
                </div>
              </div>
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
            {recoveryCodes && !snapshot.totpEnabled ? (
              <Button
                type="button"
                disabled={!codesAcknowledged || busy !== null}
                onClick={() => {
                  void act('security-initialized', async () => {
                    await client.acknowledgeRecoveryCodes()
                    setRecoveryCodes(null)
                    setCodesAcknowledged(false)
                    await refresh()
                  })
                }}
              >
                Finish security setup
              </Button>
            ) : null}
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
              onClick={() => void act('reset', () => client.resetTrust())}
            >
              Reset all trust
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
