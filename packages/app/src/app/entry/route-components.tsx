import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { toast } from '@/components/ui/toast'
import { useSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { OwnerManageScreen } from '@/app/owner/owner-manage-screen'
import { createOwnerManagementClient } from '@/app/owner/owner-management-client'
import { useOwnerRuntime } from '@/lib/owner-ws/use-owner-runtime'

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

  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!session) return <Navigate to="/login" replace />

  return <AuthenticatedWorkspace userId={session.user.id} />
}

export function AuthenticatedWorkspace({ userId }: { userId: string }) {
  const { data: session } = useSession()
  const { status, error } = useOwnerRuntime(session?.session.token)
  const runtime = useCodexRuntimeController()

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

  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  return session ? <Navigate to="/app" replace /> : <LoginScreen />
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
          request: (method, params) => ownerRuntime.runtime.request(method, params),
          close: () => ownerRuntime.runtime.close('management closed'),
        }),
      )
    } else {
      setClient(null)
      if (ownerRuntime.status === 'failed') setConnectionError(ownerRuntime.error)
    }
  }, [ownerRuntime.error, ownerRuntime.runtime, ownerRuntime.status])
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
