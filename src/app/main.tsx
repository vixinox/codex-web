import '../index.css'

import {
  Component,
  lazy,
  type ReactNode,
  StrictMode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import { toast, Toaster } from '@/components/ui/toast'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { ThemeProvider } from '@/components/shared/theme-provider'
import {
  ForbiddenPage,
  NotFoundPage,
  ServerErrorPage,
  ServiceUnavailablePage,
} from '@/app/error-pages'
import { signOut, useSession } from '@/lib/auth/auth-client'
import { AUTH_EXPIRED_EVENT, installAuthExpiryInterceptor } from '@/lib/auth/auth-expiry'
import { requiresProfileReset } from '@/lib/auth/runtime-profile'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'

const startupPageEnabled = import.meta.env.VITE_ENABLE_STARTUP_PAGE === 'true'

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

const pageFallback = <div className="min-h-svh bg-background" aria-label="Loading page" />

installAuthExpiryInterceptor()

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      {StartupScreen ? (
        <Route
          path="/startup"
          element={
            <Suspense fallback={pageFallback}>
              <StartupScreen />
            </Suspense>
          }
        />
      ) : null}
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
    return <WorkspaceShell userId="guest" profile={{ kind: 'guest' }} />
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

  componentDidCatch(error: unknown) {
    toast.add({
      title: 'Page failed to render',
      description: describeRenderError(error),
      type: 'error',
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <p className="text-sm text-muted-foreground">This screen could not be rendered.</p>
          <button
            type="button"
            className="rounded-md border px-4 py-2 text-sm"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
          >
            Reload
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

function describeRenderError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.replace(/[\r\n]+/g, ' ').slice(0, 300)
    return `${error.name}: ${message || 'No error message was provided.'}`
  }
  return 'The browser reported an unknown rendering error.'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster />
    <RootErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthExpiryHandler />
          <RuntimeProfileGuard />
        </ThemeProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
)

function AuthExpiryHandler() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refetch } = useSession()
  const refetchRef = useRef(refetch)
  const handlingRef = useRef(false)

  refetchRef.current = refetch

  useEffect(() => {
    const handleAuthExpired = () => {
      if (handlingRef.current || location.pathname === '/login') return
      handlingRef.current = true
      void signOut()
        .catch(() => undefined)
        .then(() => refetchRef.current())
        .catch(() => undefined)
        .finally(() => {
          void navigate('/login', { replace: true })
          handlingRef.current = false
        })
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
  }, [location.pathname, navigate])

  return null
}

function RuntimeProfileGuard() {
  const navigate = useNavigate()
  const { data: session, isPending, refetch } = useSession()
  const [ready, setReady] = useState(false)
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const kind = session ? (session.user as { kind?: string }).kind : undefined

  useEffect(() => {
    if (isPending) return
    if (!session) {
      setReady(true)
      return
    }
    let disposed = false
    let checking = false
    const checkProfile = async () => {
      if (checking) return
      checking = true
      try {
        const response = await fetch('/runtime-profile', { credentials: 'include' })
        if (!response.ok || disposed) {
          if (!disposed) setReady(true)
          return
        }
        const body = (await response.json()) as { profile?: unknown }
        if (disposed || (body.profile !== 'owner' && body.profile !== 'guest')) return
        const profile = body.profile
        const previous = window.sessionStorage.getItem('codex-web:runtime-profile')
        if (requiresProfileReset(previous, profile, kind)) {
          setReady(false)
          const result = await signOut()
          if (result.error || disposed) return
          window.sessionStorage.setItem('codex-web:runtime-profile', profile)
          await refetchRef.current()
          if (!disposed) void navigate('/login', { replace: true })
        } else {
          window.sessionStorage.setItem('codex-web:runtime-profile', profile)
          setReady(true)
        }
      } catch {
        if (!disposed) setReady(true)
      } finally {
        checking = false
      }
    }

    const handleResume = () => {
      if (document.visibilityState === 'visible') void checkProfile()
    }
    const handleFocus = () => void checkProfile()
    const handleOnline = () => void checkProfile()
    void checkProfile()
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleResume)
    return () => {
      disposed = true
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleResume)
    }
  }, [isPending, kind, navigate, session])

  return ready ? <App /> : pageFallback
}
