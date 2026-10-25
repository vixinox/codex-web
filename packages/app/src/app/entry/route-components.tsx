import { lazy, Suspense, useEffect } from 'react'
import { Navigate } from 'react-router'
import { toast } from '@/components/ui/toast'
import { useSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { OwnerManageScreen } from '@/app/owner/owner-manage-screen'
import { createOwnerManagementClient } from '@/app/owner/owner-management-client'

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
  const runtime = useCodexRuntimeController()

  useEffect(() => {
    if (!runtime.errorEvent) return
    toast.add({
      title: 'Codex could not start',
      description: runtime.errorEvent.message,
      type: 'error',
    })
  }, [runtime.errorEvent])

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
  if (isPending) return pageFallback
  if (!session) return <Navigate to="/login" replace />
  const rpc = async (method: string, params?: Record<string, unknown>) => {
    const response = await fetch('/api/owner/method', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params: params ?? {} }),
    })
    if (!response.ok) throw new Error(`Owner method failed (${response.status})`)
    return response.json() as Promise<unknown>
  }
  return <OwnerManageScreen client={createOwnerManagementClient(rpc)} />
}
