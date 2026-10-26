import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from '@/components/ui/toast'
import { useSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { OwnerManageScreen } from '@/app/owner/owner-manage-screen'
import { createOwnerManagementClient } from '@/app/owner/owner-management-client'
import { useOwnerRuntime } from '@/lib/owner-ws/use-owner-runtime'
import { getRemoteBootstrap } from './bootstrap'
import { Button } from '@/components/ui/button'
import { loadDeviceKey } from '@/lib/remote/device-key-store'

export const pageFallback = <div className="min-h-svh bg-background" aria-label="Loading page" />

export const startupPageEnabled = import.meta.env.VITE_ENABLE_STARTUP_PAGE === 'true'

const StartupScreen = startupPageEnabled
  ? lazy(() =>
      import('@/app/composition/screens/startup-screen').then(({ StartupScreen: screen }) => ({
        default: screen,
      })),
    )
  : null

export function StartupRoute() {
  if (!StartupScreen) return null
  return (
    <Suspense fallback={pageFallback}>
      <StartupScreen />
    </Suspense>
  )
}

export function RootRoute() {
  const { data: session, isPending } = useSession()
  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!session) return <Navigate to="/login" replace />
  return <Navigate to="/app" replace />
}

export function CandidateRoute() {
  const { data: session, isPending } = useSession()
  const location = useLocation()

  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  const remoteOwnerId = (location.state as { remoteOwnerId?: unknown } | null)?.remoteOwnerId
  if (!session && typeof remoteOwnerId !== 'string') return <Navigate to="/login" replace />

  return <AuthenticatedWorkspace userId={session?.user.id ?? (remoteOwnerId as string)} />
}

export function AuthenticatedWorkspace({ userId }: { userId: string }) {
  const { data: session } = useSession()
  const { status, error } = useOwnerRuntime(session?.session.token)
  const runtime = useCodexRuntimeController(status === 'ready')

  useEffect(() => {
    if (!runtime.errorEvent) return
    toast.add({
      title: 'Codex could not start',
      description: runtime.errorEvent.message,
      type: 'error',
    })
  }, [runtime.errorEvent])

  if (status === 'connecting' || status === 'idle')
    return <div className="min-h-svh bg-background" aria-label="Connecting Owner" />
  if (status === 'failed')
    return <div className="min-h-svh bg-background p-8 text-destructive">{error}</div>
  if (runtime.bootstrapping)
    return (
      <main className="flex min-h-svh items-center justify-center bg-background text-foreground">
        <div
          className="flex flex-col items-center gap-4 text-center"
          role="status"
          aria-live="polite"
        >
          <CodexLogo className="size-12" />
          <p className="text-sm text-muted-foreground">Starting Codex...</p>
        </div>
      </main>
    )
  return <WorkspaceShell userId={userId} runtime={runtime} />
}

export function LoginRoute() {
  const { data: session, isPending } = useSession()
  const [initialSessionResolved, setInitialSessionResolved] = useState(false)

  useEffect(() => {
    if (!isPending) setInitialSessionResolved(true)
  }, [isPending])

  if (session) return <Navigate to="/app" replace />
  if (isPending && !initialSessionResolved)
    return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (isRemoteEntry()) return <RemoteLoginRoute />
  return <PairedRemoteLoginGate />
}

function isRemoteEntry() {
  return Boolean(getRemoteBootstrap())
}

function PairedRemoteLoginGate() {
  const [checked, setChecked] = useState(false)
  const [paired, setPaired] = useState(false)
  useEffect(() => {
    let active = true
    void loadDeviceKey().then((record) => {
      if (!active) return
      setPaired(
        Boolean(record?.pairedClientToken && record.deviceId && record.nodeId && record.relayUrl),
      )
      setChecked(true)
    })
    return () => {
      active = false
    }
  }, [])
  if (!checked) return pageFallback
  return paired ? <RemoteLoginRoute /> : <LoginScreen />
}

function RemoteLoginRoute() {
  const navigate = useNavigate()
  const runtime = useOwnerRuntime(undefined)
  const remoteBootstrap = getRemoteBootstrap()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [approvalCodeKind, setApprovalCodeKind] = useState<'totp' | 'recovery'>('totp')
  const [factor, setFactor] = useState<'totp' | 'recovery' | 'approval'>('totp')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const requiresPairingFactor = Boolean(remoteBootstrap) && factor !== 'approval'
  if (runtime.status === 'connecting' || runtime.status === 'idle') return pageFallback
  if (runtime.status === 'failed')
    return <main className="p-8 text-destructive">{runtime.error}</main>
  if (!runtime.isRemote) return <LoginScreen />
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await runtime.authenticateRemoteDevice({
        credentials: { email, password },
        ...(factor === 'approval'
          ? {
              factor: {
                kind: 'approval' as const,
                ...(code ? { code, codeKind: approvalCodeKind } : {}),
              },
            }
          : code
            ? { factor: { kind: factor, code } }
            : {}),
      })
      await navigate('/app', { replace: true, state: { remoteOwnerId: result.ownerId } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Remote authentication failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6"
      >
        <h1 className="text-lg font-semibold">Connect to your Owner</h1>
        <label className="grid gap-2 text-sm">
          Email
          <input
            className="rounded-md border bg-background px-3 py-2"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {factor === 'approval' && (
          <label className="grid gap-2 text-sm">
            Sign-in verification
            <select
              className="rounded-md border bg-background px-3 py-2"
              value={approvalCodeKind}
              onChange={(event) => setApprovalCodeKind(event.target.value as 'totp' | 'recovery')}
            >
              <option value="totp">Authenticator code</option>
              <option value="recovery">Recovery code</option>
            </select>
          </label>
        )}
        <label className="grid gap-2 text-sm">
          Password
          <input
            className="rounded-md border bg-background px-3 py-2"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm">
          Verification code
          <input
            className="rounded-md border bg-background px-3 py-2"
            autoComplete="one-time-code"
            required={requiresPairingFactor}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm">
          Verification method
          <select
            className="rounded-md border bg-background px-3 py-2"
            value={factor}
            onChange={(event) => setFactor(event.target.value as 'totp' | 'recovery' | 'approval')}
          >
            <option value="totp">Authenticator code</option>
            <option value="recovery">Recovery code</option>
            {remoteBootstrap && <option value="approval">Approve on Owner machine</option>}
          </select>
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || runtime.status !== 'ready'}>
          {busy ? 'Connecting…' : requiresPairingFactor ? 'Verify and pair device' : 'Connect'}
        </Button>
      </form>
    </main>
  )
}

export function OwnerManageRoute() {
  const { data: session, isPending } = useSession()
  const [client, setClient] = useState<ReturnType<typeof createOwnerManagementClient> | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const ownerRuntime = useOwnerRuntime(session?.session.token)
  useEffect(() => {
    if (ownerRuntime.status === 'ready') {
      setConnectionError(null)
      setClient(
        createOwnerManagementClient({
          request: (method, params) => ownerRuntime.request(method, params),
          close: () => ownerRuntime.close('management closed'),
        }),
      )
    } else {
      setClient(null)
      if (ownerRuntime.status === 'failed') setConnectionError(ownerRuntime.error)
    }
  }, [ownerRuntime.close, ownerRuntime.error, ownerRuntime.request, ownerRuntime.status])
  if (isPending) return pageFallback
  if (!session) return <Navigate to="/login" replace />
  if (connectionError)
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
        <p role="alert" className="text-sm text-destructive">
          {connectionError}
        </p>
      </main>
    )
  if (!client) return pageFallback
  return <OwnerManageScreen client={client} />
}
