import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { toast } from '@/components/ui/toast'
import { useSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { OwnerManageScreen } from '@/app/owner/owner-manage-screen'
import { createOwnerManagementClient } from '@/app/owner/owner-management-client'
import { useOwnerRuntime } from '@/lib/owner-ws/use-owner-runtime'
import { loadDeviceKey, loadRemoteOwnerSession } from '@/lib/remote/device-key-store'

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
  if (session.user.twoFactorEnabled !== true) return <Navigate to="/login" replace />
  return <Navigate to="/app" replace />
}

export function CandidateRoute() {
  const { data: session, isPending } = useSession()
  const location = useLocation()
  const [remoteOwnerId, setRemoteOwnerId] = useState<string | null>(null)
  const [remoteChecked, setRemoteChecked] = useState(false)
  useEffect(() => {
    let active = true
    void loadDeviceKey()
      .then(async (record) => {
        if (!record?.pairedClientToken || !record.deviceId || !record.relayUrl || !record.ownerCode)
          return null
        return loadRemoteOwnerSession({
          relayUrl: record.relayUrl,
          ownerCode: record.ownerCode,
          nodeId: record.nodeId ?? '',
          deviceId: record.deviceId,
          ownerId: record.ownerId ?? undefined,
        })
      })
      .then((saved) => {
        if (active) setRemoteOwnerId(saved?.ownerId ?? null)
      })
      .catch(() => {
        if (active) setRemoteOwnerId(null)
      })
      .finally(() => {
        if (active) setRemoteChecked(true)
      })
    return () => {
      active = false
    }
  }, [])

  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!remoteChecked) return pageFallback
  const stateOwnerId = (location.state as { remoteOwnerId?: unknown } | null)?.remoteOwnerId
  if (session && session.user.twoFactorEnabled !== true) return <Navigate to="/login" replace />
  const ownerId = session?.user.id ?? remoteOwnerId ?? stateOwnerId
  if (!session && typeof ownerId !== 'string') return <Navigate to="/login" replace />

  return <AuthenticatedWorkspace userId={ownerId as string} />
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

  if (session?.user.twoFactorEnabled === true) return <Navigate to="/app" replace />
  if (isPending && !initialSessionResolved)
    return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (session) return <LoginScreen securitySetupRequired />
  return <LoginScreen />
}

export function OwnerManageRoute() {
  const { data: session, isPending } = useSession()
  const [client, setClient] = useState<ReturnType<typeof createOwnerManagementClient> | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const {
    status: ownerStatus,
    error: ownerError,
    request: ownerRequest,
    close: closeOwnerRuntime,
  } = useOwnerRuntime(session?.session.token)
  const requestOwner = useCallback(
    (method: string, params?: Record<string, unknown>) => ownerRequest(method, params),
    [ownerRequest],
  )
  const closeOwner = useCallback(() => closeOwnerRuntime('management closed'), [closeOwnerRuntime])
  useEffect(() => {
    if (ownerStatus === 'ready') {
      setConnectionError(null)
      setClient(
        createOwnerManagementClient({
          request: requestOwner,
          close: closeOwner,
        }),
      )
    } else {
      setClient(null)
      if (ownerStatus === 'failed') setConnectionError(ownerError)
    }
  }, [closeOwner, ownerError, requestOwner, ownerStatus])
  if (isPending) return pageFallback
  if (!session || session.user.twoFactorEnabled !== true) return <Navigate to="/login" replace />
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
