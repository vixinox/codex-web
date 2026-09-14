import '../index.css'

import { Component, lazy, type ReactNode, StrictMode, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { toast, Toaster } from '@/components/ui/toast'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { ThemeProvider } from '@/components/shared/theme-provider'
import {
  ForbiddenPage,
  NotFoundPage,
  ServerErrorPage,
  ServiceUnavailablePage,
} from '@/app/error-pages'
import { useSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { CodexStartupScreen } from '@/app/composition/screens/codex-startup-screen'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'

const StartupScreen = lazy(() =>
  import('@/app/composition/screens/startup-screen').then(({ StartupScreen: screen }) => ({
    default: screen,
  })),
)

const AdminScreen = lazy(() =>
  import('@/app/composition/screens/admin-screen').then(({ AdminScreen: screen }) => ({
    default: screen,
  })),
)

const GuestWorkspaceScreen = lazy(() =>
  import('@/app/composition/screens/guest-workspace-screen').then(
    ({ GuestWorkspaceScreen: screen }) => ({ default: screen }),
  ),
)

const pageFallback = <div className="min-h-svh bg-background" aria-label="Loading page" />

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route
        path="/startup"
        element={
          <Suspense fallback={pageFallback}>
            <StartupScreen />
          </Suspense>
        }
      />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/admin/*" element={<AdminRoute />} />
      <Route path="/app/*" element={<CandidateRoute />} />
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/500" element={<ServerErrorPage />} />
      <Route path="/503" element={<ServiceUnavailablePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

function RootRoute() {
  const { data: session, isPending } = useSession()
  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!session) return <Navigate to="/login" replace />
  const kind = (session.user as { kind?: string }).kind
  return <Navigate to={kind === 'admin' ? '/admin' : '/app'} replace />
}

function CandidateRoute() {
  const { data: session, isPending } = useSession()

  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!session) return <Navigate to="/login" replace />

  if ((session.user as { kind?: string }).kind === 'guest')
    return (
      <Suspense fallback={pageFallback}>
        <GuestWorkspaceScreen />
      </Suspense>
    )
  return <AuthenticatedWorkspace userId={session.user.id} />
}

function AdminRoute() {
  const { data: session, isPending } = useSession()
  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  if (!session) return <Navigate to="/login" replace />
  if ((session.user as { kind?: string }).kind !== 'admin') return <ForbiddenPage />
  return (
    <Suspense fallback={pageFallback}>
      <AdminScreen />
    </Suspense>
  )
}

function AuthenticatedWorkspace({ userId }: { userId: string }) {
  const runtime = useCodexRuntimeController()

  useEffect(() => {
    if (!runtime.errorEvent) return
    toast.add({
      title: 'Codex could not start',
      description: runtime.errorEvent.message,
      type: 'error',
    })
  }, [runtime.errorEvent])

  if (runtime.bootstrapping) return <CodexStartupScreen />
  return <WorkspaceShell userId={userId} runtime={runtime} />
}

function LoginRoute() {
  const { data: session, isPending } = useSession()

  if (isPending) return <div className="min-h-svh bg-background" aria-label="Loading session" />
  const kind = session ? (session.user as { kind?: string }).kind : undefined
  return session ? <Navigate to={kind === 'admin' ? '/admin' : '/app'} replace /> : <LoginScreen />
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: unknown }
> {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <ServerErrorPage
          onRetry={() => {
            this.setState({ hasError: false, error: null })
            window.location.reload()
          }}
        />
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <App />
          <Toaster />
        </ThemeProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
)
