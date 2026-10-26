import * as React from 'react'
import { authClient, signIn, signUp } from '@/lib/auth/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Loader2, KeyRound } from 'lucide-react'

function formText(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export function LoginScreen() {
  const [mode, setMode] = React.useState<'sign-in' | 'sign-up' | 'initializing'>('initializing')
  const [ownerExists, setOwnerExists] = React.useState<boolean | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [waitingForSession, setWaitingForSession] = React.useState(false)
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
    <div className="flex min-h-svh flex-col items-center justify-center bg-zinc-50 px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-8 md:p-10 dark:bg-zinc-950">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card className="border-zinc-200/60 bg-white/90 shadow-xl shadow-zinc-200/40 backdrop-blur-sm dark:border-zinc-800/60 dark:bg-zinc-900/90 dark:shadow-black/40">
          <CardContent className="p-4 transition-all duration-300 sm:p-6">
            {mode === 'initializing' ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                <span className="text-sm text-zinc-500">Connecting...</span>
              </div>
            ) : (
              <div key={mode} className="native-fade-blur flex flex-col">
                <form onSubmit={handleSubmit}>
                  {mode === 'sign-up' && (
                    <div className="mb-6 text-center">
                      <h2 className="text-lg font-medium">Initialize System</h2>
                      <p className="mt-1 text-sm text-zinc-500">Create the local owner account</p>
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
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        ref={emailInputRef}
                        id="email"
                        name="email"
                        type="email"
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
