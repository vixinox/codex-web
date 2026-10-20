import { lazy, Suspense, useEffect } from 'react'
import { Navigate } from 'react-router'
import { toast } from '@/components/ui/toast'
import { useSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { ForbiddenPage } from '@/app/error-pages'
import { getSessionKind } from '@/app/entry/session-kind'

export const pageFallback = <div className="min-h-svh bg-background" aria-label="Loading page" />

export const startupPageEnabled = import.meta.env.VITE_ENABLE_STARTUP_PAGE === 'true'

const StartupScreen = startupPageEnabled
  ? lazy(() =>
      import('@/app/composition/screens/startup-screen').then(({ StartupScreen: screen }) => ({
        default: screen,
      })),
    )
  : null

const AdminScreen = lazy(() =>
  import('@/app/composition/screens/admin-screen').then(({ AdminScreen: screen }) => ({
    default: screen,
  })),
)

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
  const kind = getSessionKind(session.user)
  return <Navigate to={kind === 'admin' ? '/admin' : '/app'} replace />
}

export function CandidateRoute() {
  const { data: session, isPending } = useSession()

  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!session) return <Navigate to="/login" replace />

  if (getSessionKind(session.user) === 'guest')
    return <WorkspaceShell userId="guest" profile={{ kind: 'guest' }} />
  return <AuthenticatedWorkspace userId={session.user.id} />
}

export function AdminRoute() {
  const { data: session, isPending } = useSession()
  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!session) return <Navigate to="/login" replace />
  if (getSessionKind(session.user) !== 'admin') return <ForbiddenPage />
  return (
    <Suspense fallback={pageFallback}>
      <AdminScreen />
    </Suspense>
  )
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
  const kind = session ? getSessionKind(session.user) : undefined
  return session ? <Navigate to={kind === 'admin' ? '/admin' : '/app'} replace /> : <LoginScreen />
}
