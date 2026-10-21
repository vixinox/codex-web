import * as React from 'react'
import { useNavigate } from 'react-router'
import { signIn, signUp } from '@/lib/auth/auth-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Loader2, KeyRound } from 'lucide-react'

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
                        id="email"
                        name="email"
                        type="email"
                        placeholder="you@example.com"
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
