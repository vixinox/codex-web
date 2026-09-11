import * as React from 'react'
import { useNavigate } from 'react-router'
import { signIn, signUp } from '@/lib/auth/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { gsap } from 'gsap'
import { Loader2, User, KeyRound } from 'lucide-react'
import { startGuestSession } from '@/lib/bridge/http/guest'

function formText(data: FormData, name: string) {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export function LoginScreen() {
  const navigate = useNavigate()

  const [mode, setMode] = React.useState<'sign-in' | 'sign-up' | 'initializing'>('initializing')
  const [ownerExists, setOwnerExists] = React.useState<boolean | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [runtimeProfile, setRuntimeProfile] = React.useState<'owner' | 'guest' | null>(null)

  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    const minLoadTime = new Promise((resolve) => setTimeout(resolve, 400))
    const fetchProfile = fetch('/runtime-profile', { signal: controller.signal })

    void Promise.all([fetchProfile, minLoadTime])
      .then(async ([profileResponse]) => {
        if (!profileResponse.ok) throw new Error('Runtime profile is unavailable')
        const profileBody = (await profileResponse.json()) as { profile?: unknown }
        if (profileBody.profile !== 'owner' && profileBody.profile !== 'guest') {
          throw new Error('Runtime profile is unavailable')
        }
        setRuntimeProfile(profileBody.profile)

        if (profileBody.profile === 'guest') {
          setOwnerExists(true)
          setMode('sign-in')
          return undefined
        }

        const bootstrapResponse = await fetch('/api/auth/bootstrap', {
          credentials: 'include',
          signal: controller.signal,
        })
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

  React.useEffect(() => {
    if (!contentRef.current || mode === 'initializing') return

    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.gsap-fade',
        { opacity: 0, filter: 'blur(4px)' },
        { opacity: 1, filter: 'blur(0px)', duration: 0.35, ease: 'power2.out', clearProps: 'all' },
      )
    }, contentRef)

    return () => ctx.revert()
  }, [mode])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const form = new FormData(event.currentTarget)
    const email = formText(form, 'email')
    const password = formText(form, 'password')

    const result =
      mode === 'sign-up'
        ? await signUp.email({ email, password, name: formText(form, 'name') })
        : await signIn.email({ email, password })

    setIsSubmitting(false)

    if (result.error) {
      setError(result.error.message ?? 'Authentication failed')
      return
    }
    void navigate('/app', { replace: true })
  }

  async function handleGuest() {
    setError(null)
    setIsSubmitting(true)
    try {
      await startGuestSession()
      window.location.replace('/app')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Guest access failed'
      setError(message)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-zinc-50 p-6 md:p-10 dark:bg-zinc-950">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card className="border-zinc-200/60 bg-white/90 shadow-xl shadow-zinc-200/40 backdrop-blur-sm dark:border-zinc-800/60 dark:bg-zinc-900/90 dark:shadow-black/40">
          <CardContent className="p-6 transition-all duration-300" ref={contentRef}>
            {mode === 'initializing' ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                <span className="text-sm text-zinc-500">Connecting...</span>
              </div>
            ) : (
              <div className="gsap-fade flex flex-col">
                <form onSubmit={handleSubmit}>
                  {mode === 'sign-up' && (
                    <div className="mb-6 text-center">
                      <h2 className="text-lg font-medium">Initialize System</h2>
                      <p className="mt-1 text-sm text-zinc-500">Create the first administrator</p>
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
                        id="email"
                        name="email"
                        type="email"
                        placeholder="admin@example.com"
                        autoComplete="email"
                        required
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
                      />
                    </Field>

                    {error && (
                      <p className="text-sm font-medium text-red-500" role="alert">
                        {error}
                      </p>
                    )}

                    <Field className="pt-2">
                      <Button type="submit" disabled={isSubmitting} className="w-full">
                        {isSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            {mode === 'sign-in' && <KeyRound className="mr-2 h-4 w-4 opacity-70" />}
                            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
                          </>
                        )}
                      </Button>

                      {ownerExists === false && (
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

                <div className="mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting || runtimeProfile !== 'guest'}
                    onClick={handleGuest}
                    className="group relative h-12 w-full border-dashed bg-zinc-100/50 hover:bg-zinc-100 dark:bg-zinc-800/30 dark:hover:bg-zinc-800"
                  >
                    <User className="mr-2 h-4 w-4 text-zinc-500 transition-colors group-hover:text-zinc-900 dark:group-hover:text-white" />
                    <span className="font-medium text-zinc-600 transition-colors group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-white">
                      {runtimeProfile === 'guest'
                        ? 'Continue as Guest'
                        : 'Guest unavailable on this profile'}
                    </span>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
