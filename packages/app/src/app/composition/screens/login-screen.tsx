import * as React from 'react'
import { authClient, signIn, signUp } from '@/lib/auth/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Loader2, KeyRound } from 'lucide-react'
import {
  checkOwnerCodeAvailability,
  readOwnerCodePreference,
  saveRecentOwnerTarget,
  readKnownOwnerFingerprint,
  unlockOwnerCodeEditing,
  rememberOwnerFingerprint,
  type OwnerCodeAvailability,
} from '@/lib/remote/owner-code-preference'
import { loadDeviceKey } from '@/lib/remote/device-key-store'
import { inspectRemoteOwnerFingerprint, loginToRemoteOwner } from '@/lib/remote/admission'
import { LoginQrScanner } from '@/app/owner/login-qr-scanner'
import { redeemLoginQr } from '@/lib/remote/admission'
import { useNavigate } from 'react-router'

function formText(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

function RemoteOnboardingPanel() {
  const initial = React.useMemo(() => readOwnerCodePreference(), [])
  const [ownerCode, setOwnerCode] = React.useState(initial.ownerCode)
  const [editable, setEditable] = React.useState(initial.editable || !initial.ownerCode)
  const [relayUrl, setRelayUrl] = React.useState(initial.target?.relayUrl ?? '')
  const [availability, setAvailability] = React.useState<OwnerCodeAvailability>('idle')
  const [owner, setOwner] = React.useState<{ nodeId: string; trustEpoch: number } | null>(null)
  const [fingerprint, setFingerprint] = React.useState('')
  const [confirmation, setConfirmation] = React.useState<'idle' | 'saved' | 'mismatch'>('idle')
  const [savedFingerprint, setSavedFingerprint] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [factorKind, setFactorKind] = React.useState<'totp' | 'recovery'>('totp')
  const [showLogin, setShowLogin] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [factorCode, setFactorCode] = React.useState('')
  const [scanningQr, setScanningQr] = React.useState(false)
  const navigate = useNavigate()

  React.useEffect(() => {
    let active = true
    void loadDeviceKey().then((record) => {
      if (active && !initial.target?.relayUrl && record?.relayUrl) setRelayUrl(record.relayUrl)
      return record
    })
    return () => {
      active = false
    }
  }, [initial.target?.relayUrl])

  React.useEffect(() => {
    if (ownerCode.length !== 9 || !relayUrl) {
      setAvailability('idle')
      setOwner(null)
      return
    }
    let active = true
    setAvailability('checking')
    const timeout = window.setTimeout(() => {
      void checkOwnerCodeAvailability({ relayUrl, ownerCode }).then((result) => {
        if (!active) return
        setAvailability(result.status)
        setOwner(
          result.status === 'online'
            ? { nodeId: result.nodeId, trustEpoch: result.trustEpoch }
            : null,
        )
        setConfirmation('idle')
        return result
      })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [ownerCode, relayUrl])

  React.useEffect(() => {
    const known = owner ? readKnownOwnerFingerprint(relayUrl, owner.nodeId) : null
    setSavedFingerprint(known)
    setFingerprint(known ?? '')
  }, [owner, relayUrl])

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 className="text-base font-semibold">Connect to a remote Owner</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is separate from signing in to the Owner running on this machine.
          </p>
        </div>
        <FieldGroup>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="remote-owner-code">Owner connection code</FieldLabel>
              {initial.ownerCode && !editable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    unlockOwnerCodeEditing()
                    setEditable(true)
                  }}
                >
                  Change device
                </Button>
              ) : null}
            </div>
            <Input
              id="remote-owner-code"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{9}"
              maxLength={9}
              placeholder="9-digit code"
              value={ownerCode}
              readOnly={!editable}
              onChange={(event) => setOwnerCode(event.target.value.replace(/\D/gu, '').slice(0, 9))}
            />
            {initial.ownerCode && !editable ? (
              <p className="text-xs text-muted-foreground">Last used</p>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="remote-relay-url">Relay URL</FieldLabel>
            <Input
              id="remote-relay-url"
              autoComplete="url"
              placeholder="wss://relay.example.com/ws"
              value={relayUrl}
              onChange={(event) => setRelayUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {availability === 'checking'
                ? 'Checking Relay…'
                : availability === 'online'
                  ? 'Owner online'
                  : availability === 'offline'
                    ? 'Owner unavailable'
                    : availability === 'unreachable'
                      ? 'Relay unreachable'
                      : 'Enter a Relay URL and 9-digit Owner code'}
            </p>
          </Field>
          {owner ? (
            <Field>
              <FieldLabel htmlFor="remote-owner-fingerprint">
                Owner public-key fingerprint
              </FieldLabel>
              <Input
                id="remote-owner-fingerprint"
                autoComplete="off"
                spellCheck={false}
                placeholder="Read from the local Owner management page"
                value={fingerprint}
                onChange={(event) => {
                  setFingerprint(event.target.value.trim())
                  setConfirmation('idle')
                }}
              />
              <p className="text-xs text-muted-foreground">
                {savedFingerprint
                  ? 'Compare this saved fingerprint with the value shown in local Owner management.'
                  : 'For a first connection, compare this value with the fingerprint shown in local Owner management.'}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={!fingerprint || busy}
                onClick={() => {
                  void inspectRemoteOwnerFingerprint({
                    relayUrl,
                    ownerCode,
                    nodeId: owner.nodeId,
                    trustEpoch: owner.trustEpoch,
                  })
                    .then((actual) => {
                      if (actual !== fingerprint) {
                        setConfirmation('mismatch')
                        return actual
                      }
                      rememberOwnerFingerprint(relayUrl, owner.nodeId, fingerprint)
                      setSavedFingerprint(fingerprint)
                      setConfirmation('saved')
                      return actual
                    })
                    .catch((cause: unknown) =>
                      setError(
                        cause instanceof Error ? cause.message : 'Fingerprint check failed.',
                      ),
                    )
                }}
              >
                Verify and save fingerprint
              </Button>
              {confirmation === 'saved' ? (
                <p role="status" className="text-xs text-success">
                  Fingerprint verified against the remote Owner.
                </p>
              ) : null}
              {confirmation === 'mismatch' ? (
                <p role="alert" className="text-xs text-destructive">
                  The supplied fingerprint does not match this Owner.
                </p>
              ) : null}
            </Field>
          ) : null}
          {owner ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={!savedFingerprint || availability !== 'online' || busy}
                onClick={() => setShowLogin(true)}
              >
                Continue with Owner credentials
              </Button>
              {showLogin ? (
                <form
                  className="grid gap-3 border-t border-border pt-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    setBusy(true)
                    setError(null)
                    void loginToRemoteOwner({
                      relayUrl,
                      ownerCode,
                      nodeId: owner.nodeId,
                      trustEpoch: owner.trustEpoch,
                      expectedFingerprint: savedFingerprint!,
                      credentials: { email, password },
                      factor: { kind: factorKind, code: factorCode },
                    })
                      .then((result) => {
                        saveRecentOwnerTarget({ relayUrl, ownerCode, nodeId: owner.nodeId })
                        void navigate('/app', {
                          replace: true,
                          state: { remoteOwnerId: result.ownerId },
                        })
                        return result
                      })
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : 'Remote sign-in failed.'),
                      )
                      .finally(() => setBusy(false))
                  }}
                >
                  <Input
                    type="email"
                    autoComplete="username"
                    placeholder="Owner email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="Password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      autoComplete="one-time-code"
                      placeholder={factorKind === 'totp' ? 'Authenticator code' : 'Recovery code'}
                      required
                      value={factorCode}
                      onChange={(event) => setFactorCode(event.target.value)}
                    />
                    <select
                      aria-label="Verification method"
                      value={factorKind}
                      onChange={(event) => setFactorKind(event.target.value as 'totp' | 'recovery')}
                    >
                      <option value="totp">TOTP</option>
                      <option value="recovery">Recovery</option>
                    </select>
                  </div>
                  <Button type="submit" disabled={busy || !savedFingerprint}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : 'Sign in remotely'}
                  </Button>
                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                </form>
              ) : null}
            </>
          ) : null}
          <Button type="button" variant="link" onClick={() => setScanningQr(true)}>
            Sign in with QR code
          </Button>
        </FieldGroup>
        {scanningQr ? (
          <LoginQrScanner
            onClose={() => setScanningQr(false)}
            onRedeem={async (payload) => {
              const result = await redeemLoginQr(payload)
              saveRecentOwnerTarget({
                relayUrl: payload.relayUrl,
                ownerCode: payload.ownerCode,
                nodeId: payload.nodeId,
              })
              await navigate('/app', {
                replace: true,
                state: { remoteOwnerId: result.ownerId },
              })
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

export function LoginScreen({
  securitySetupRequired = false,
}: {
  securitySetupRequired?: boolean
}) {
  const [mode, setMode] = React.useState<'sign-in' | 'sign-up' | 'initializing'>('initializing')
  const [ownerExists, setOwnerExists] = React.useState<boolean | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [waitingForSession, setWaitingForSession] = React.useState(false)
  const [needsSecuritySetup, setNeedsSecuritySetup] = React.useState(securitySetupRequired)
  const [setupTotpUri, setSetupTotpUri] = React.useState<string | null>(null)
  const [setupTotpCode, setSetupTotpCode] = React.useState('')
  const [setupRecoveryCodes, setSetupRecoveryCodes] = React.useState<string[] | null>(null)
  const [setupCodesSaved, setSetupCodesSaved] = React.useState(false)
  const [setupTotpVerified, setSetupTotpVerified] = React.useState(false)
  const [setupPassword, setSetupPassword] = React.useState('')
  const [challengeMethods, setChallengeMethods] = React.useState<string[] | null>(null)
  const [verificationMethod, setVerificationMethod] = React.useState<'totp' | 'recovery'>('totp')
  const [verificationCode, setVerificationCode] = React.useState('')
  const [email, setEmail] = React.useState('')
  const emailInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!waitingForSession) return
    const timeout = window.setTimeout(() => {
      setWaitingForSession(false)
      setError(
        'Sign-in completed, but no active session was found. Check the browser session cookie and try again.',
      )
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [waitingForSession])

  React.useEffect(() => {
    const controller = new AbortController()
    const minLoadTime = new Promise((resolve) => setTimeout(resolve, 400))
    const fetchBootstrap = fetch('/api/auth/bootstrap', {
      credentials: 'include',
      signal: controller.signal,
    })

    void Promise.all([fetchBootstrap, minLoadTime])
      .then(async ([bootstrapResponse]) => {
        if (!bootstrapResponse.ok) throw new Error('Bootstrap state is unavailable')
        const body = (await bootstrapResponse.json()) as { ownerExists?: unknown }
        const exists = body.ownerExists === true
        setOwnerExists(exists)
        setMode(exists ? 'sign-in' : 'sign-up')
        return undefined
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOwnerExists(true)
          setMode('sign-in')
        }
      })

    return () => controller.abort()
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      if (challengeMethods) {
        const result =
          verificationMethod === 'totp'
            ? await authClient.twoFactor.verifyTotp({ code: verificationCode })
            : await authClient.twoFactor.verifyBackupCode({ code: verificationCode })
        if (result.error) {
          setError(result.error.message ?? 'Verification failed')
          return
        }
        setVerificationCode('')
        setWaitingForSession(true)
        return
      }

      const form = new FormData(event.currentTarget)
      const submittedEmail = formText(form, 'email')
      const password = formText(form, 'password')
      const result =
        mode === 'sign-up'
          ? await signUp.email({ email: submittedEmail, password, name: formText(form, 'name') })
          : await signIn.email({ email: submittedEmail, password })

      if (result.error) {
        setError(result.error.message ?? 'Authentication failed')
        return
      }
      if (mode === 'sign-up' && result.data?.token) {
        setSetupPassword(password)
        setNeedsSecuritySetup(true)
        return
      }
      if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
        const methods =
          'twoFactorMethods' in result.data && Array.isArray(result.data.twoFactorMethods)
            ? result.data.twoFactorMethods.filter(
                (method): method is string => typeof method === 'string',
              )
            : []
        setChallengeMethods(methods)
        setVerificationMethod(methods.includes('totp') ? 'totp' : 'recovery')
        return
      }
      setWaitingForSession(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-foreground sm:p-8 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card className="border-border bg-card shadow-lg">
          <CardContent className="p-4 transition-all duration-300 sm:p-6">
            {needsSecuritySetup ? (
              <div className="space-y-4">
                <div>
                  <h1 className="text-lg font-semibold">Secure your Owner account</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Configure an authenticator and save recovery codes before continuing.
                  </p>
                </div>
                {!setupTotpUri ? (
                  <Input
                    type="password"
                    autoComplete="current-password"
                    aria-label="Owner password"
                    placeholder="Owner password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    required
                  />
                ) : null}
                {!setupTotpUri ? (
                  <Button
                    type="button"
                    disabled={isSubmitting || !setupPassword}
                    onClick={() => {
                      setIsSubmitting(true)
                      void fetch('/api/auth/owner-security/setup', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ password: setupPassword }),
                      })
                        .then(async (response) => {
                          const body = (await response.json()) as {
                            totpURI?: unknown
                            backupCodes?: unknown
                          }
                          if (!response.ok) throw new Error('TOTP setup failed.')
                          return body
                        })
                        .then((result) => {
                          setSetupTotpUri(
                            typeof result.totpURI === 'string' ? result.totpURI : null,
                          )
                          setSetupRecoveryCodes(
                            Array.isArray(result.backupCodes) &&
                              result.backupCodes.every((code) => typeof code === 'string')
                              ? result.backupCodes
                              : null,
                          )
                          return result
                        })
                        .catch((cause: unknown) =>
                          setError(cause instanceof Error ? cause.message : 'TOTP setup failed'),
                        )
                        .finally(() => setIsSubmitting(false))
                    }}
                  >
                    Set up authenticator
                  </Button>
                ) : null}
                {setupTotpUri ? (
                  <div className="space-y-3">
                    <p className="break-all text-xs text-muted-foreground">{setupTotpUri}</p>
                    <InputOTP
                      aria-label="6-digit authenticator code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={setupTotpCode}
                      onChange={setSetupTotpCode}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }, (_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                    <Button
                      type="button"
                      disabled={setupTotpCode.length !== 6 || isSubmitting}
                      onClick={() => {
                        setIsSubmitting(true)
                        void fetch('/api/auth/owner-security/verify', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ code: setupTotpCode }),
                        })
                          .then(async (response) => {
                            const body = (await response.json()) as {
                              token?: unknown
                              user?: { twoFactorEnabled?: unknown }
                            }
                            if (!response.ok || body.user?.twoFactorEnabled !== true)
                              throw new Error('Authenticator verification failed.')
                            setSetupTotpVerified(true)
                            setSetupCodesSaved(false)
                            return body
                          })
                          .catch((cause: unknown) =>
                            setError(cause instanceof Error ? cause.message : 'TOTP check failed'),
                          )
                          .finally(() => setIsSubmitting(false))
                      }}
                    >
                      Verify authenticator
                    </Button>
                    {setupRecoveryCodes ? (
                      <div className="space-y-3 border-t border-border pt-3">
                        <pre className="grid grid-cols-2 gap-1 text-xs">
                          {setupRecoveryCodes.join('\n')}
                        </pre>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={setupCodesSaved}
                            onChange={(event) => setSetupCodesSaved(event.target.checked)}
                          />
                          I saved these recovery codes
                        </label>
                        <Button
                          type="button"
                          disabled={!setupCodesSaved || !setupTotpVerified || isSubmitting}
                          onClick={() => {
                            setIsSubmitting(true)
                            setError(null)
                            void fetch('/api/auth/owner-security/complete', {
                              method: 'POST',
                              credentials: 'include',
                            })
                              .then(async (response) => {
                                if (!response.ok)
                                  throw new Error('Recovery code confirmation could not be saved.')
                                window.location.assign('/app')
                                return response
                              })
                              .catch((cause: unknown) =>
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : 'Security setup could not be completed.',
                                ),
                              )
                              .finally(() => setIsSubmitting(false))
                          }}
                        >
                          Finish security setup
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : mode === 'initializing' ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                <span className="text-sm text-muted-foreground">Connecting...</span>
              </div>
            ) : (
              <div key={mode} className="native-fade-blur flex flex-col">
                <form onSubmit={handleSubmit}>
                  {mode === 'sign-up' && (
                    <div className="mb-6 text-center">
                      <h2 className="text-lg font-medium">Initialize System</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Create the local owner account
                      </p>
                    </div>
                  )}

                  <FieldGroup>
                    {mode === 'sign-up' && (
                      <Field>
                        <FieldLabel htmlFor="name">Name</FieldLabel>
                        <Input id="name" name="name" autoComplete="name" required />
                      </Field>
                    )}

                    <Field>
                      <FieldLabel htmlFor="email">Owner email</FieldLabel>
                      <Input
                        ref={emailInputRef}
                        id="email"
                        name="email"
                        type="email"
                        inputMode="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        readOnly={Boolean(challengeMethods)}
                        disabled={isSubmitting || waitingForSession}
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        minLength={8}
                        placeholder="••••••••"
                        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                        required
                        readOnly={Boolean(challengeMethods)}
                        disabled={isSubmitting || waitingForSession}
                      />
                    </Field>

                    {challengeMethods ? (
                      <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
                        <div className="mb-3">
                          <p className="text-sm font-medium">Two-step verification</p>
                        </div>
                        <Field>
                          {verificationMethod === 'totp' ? (
                            <InputOTP
                              id="verification-code"
                              name="verificationCode"
                              aria-label="6-digit authenticator code"
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={6}
                              required
                              value={verificationCode}
                              onChange={setVerificationCode}
                              disabled={isSubmitting || waitingForSession}
                              containerClassName="w-full justify-center"
                            >
                              <InputOTPGroup>
                                {Array.from({ length: 6 }, (_, index) => (
                                  <InputOTPSlot
                                    key={index}
                                    index={index}
                                    className="size-10 text-base sm:size-11"
                                  />
                                ))}
                              </InputOTPGroup>
                            </InputOTP>
                          ) : (
                            <Input
                              id="verification-code"
                              name="verificationCode"
                              autoComplete="one-time-code"
                              autoCapitalize="none"
                              spellCheck={false}
                              required
                              value={verificationCode}
                              onChange={(event) => setVerificationCode(event.target.value)}
                              disabled={isSubmitting || waitingForSession}
                            />
                          )}
                        </Field>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <Button
                            type="button"
                            variant="link"
                            className="justify-start px-0"
                            disabled={isSubmitting || waitingForSession}
                            onClick={() => {
                              setVerificationMethod(
                                verificationMethod === 'totp' ? 'recovery' : 'totp',
                              )
                              setVerificationCode('')
                              setError(null)
                            }}
                          >
                            {verificationMethod === 'totp'
                              ? 'Use recovery code'
                              : 'Use authenticator code'}
                          </Button>
                          <Button
                            type="button"
                            variant="link"
                            className="justify-start px-0 text-muted-foreground"
                            disabled={isSubmitting || waitingForSession}
                            onClick={() => {
                              setChallengeMethods(null)
                              setVerificationCode('')
                              setError(null)
                              requestAnimationFrame(() => emailInputRef.current?.focus())
                            }}
                          >
                            Use a different account
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {error && (
                      <p className="text-sm font-medium text-red-500" role="alert">
                        {error}
                      </p>
                    )}

                    <Field className="pt-2">
                      <Button
                        type="submit"
                        disabled={isSubmitting || waitingForSession}
                        className="w-full"
                      >
                        {isSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            {mode === 'sign-in' ? (
                              <KeyRound className="mr-2 h-4 w-4 opacity-70" />
                            ) : null}
                            {challengeMethods
                              ? 'Verify and sign in'
                              : mode === 'sign-in'
                                ? 'Sign in'
                                : 'Create account'}
                          </>
                        )}
                      </Button>
                      {waitingForSession ? (
                        <p role="status" className="text-center text-xs text-zinc-500">
                          Restoring session...
                        </p>
                      ) : null}

                      {ownerExists === false && !challengeMethods && (
                        <Button
                          type="button"
                          variant="link"
                          disabled={isSubmitting}
                          onClick={() => {
                            setError(null)
                            setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'))
                          }}
                          className="mt-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                        >
                          {mode === 'sign-in' ? 'Create local owner' : 'Use existing owner'}
                        </Button>
                      )}
                    </Field>
                  </FieldGroup>
                </form>
                {mode === 'sign-in' && !challengeMethods ? <RemoteOnboardingPanel /> : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
