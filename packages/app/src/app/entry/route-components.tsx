import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from '@/components/ui/toast'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { ConnectionScreen } from '@/app/settings/connection/connection-screen'
import { createConnectionClient } from '@/app/settings/connection/connection-client'
import { useOwnerRuntime } from '@/lib/owner-ws/use-owner-runtime'
import { isKnownAppRoute } from '@/app/composition/routes/route-model'
import { MobileWorkspaceNavigation } from '@/app/composition/navigation/workspace-navigation'
import { SettingsSidebar } from '@/app/composition/navigation/settings-sidebar'
import {
  SettingsPageError,
  SettingsPageDelayedLoading,
  SettingsPageLayout,
} from '@/app/settings/settings-page-layout'
import {
  readWorkspaceSidebarWidth,
  storeWorkspaceSidebarWidth,
} from '@/app/workspace/sidebar/sidebar-storage'
import { ownerTargetKind } from '@/lib/owner-ws/target'

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
  if (ownerTargetKind(window.location.origin) === 'local') return <Navigate to="/app" replace />
  const connectionProfileId = sessionStorage.getItem('codex-web:active-connection-profile')
  if (connectionProfileId)
    return <Navigate to={`/app?connection=${encodeURIComponent(connectionProfileId)}`} replace />
  return <Navigate to="/login" replace />
}

export function CandidateRoute() {
  const location = useLocation()
  const routeState = location.state as {
    connectionProfileId?: unknown
  } | null
  const local = ownerTargetKind(window.location.origin) === 'local'
  const profileId = local
    ? undefined
    : typeof routeState?.connectionProfileId === 'string'
      ? routeState.connectionProfileId
      : (new URLSearchParams(location.search).get('connection') ??
        sessionStorage.getItem('codex-web:active-connection-profile') ??
        undefined)

  if (!isKnownAppRoute(location.pathname)) return <Navigate to="/app" replace />
  if (!local && !profileId) return <Navigate to="/login" replace />

  return <AuthenticatedWorkspace connectionProfileId={profileId} />
}

export function AuthenticatedWorkspace({ connectionProfileId }: { connectionProfileId?: string }) {
  const { status, error, ownerId, isRemote } = useOwnerRuntime(connectionProfileId)
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
  if (!ownerId)
    return (
      <div className="min-h-svh bg-background p-8 text-destructive">
        Owner identity is unavailable.
      </div>
    )
  return <WorkspaceShell userId={ownerId} runtime={runtime} isRemote={isRemote} />
}

export function LoginRoute() {
  const location = useLocation()
  if (ownerTargetKind(window.location.origin) === 'local') return <Navigate to="/app" replace />
  if (location.pathname === '/app/enroll' || new URLSearchParams(location.search).has('ref'))
    return <LoginScreen />
  if (sessionStorage.getItem('codex-web:active-connection-profile'))
    return <Navigate to="/app" replace />
  return <LoginScreen />
}

export function ConnectionSettingsContent() {
  const [retryVersion, setRetryVersion] = useState(0)

  return (
    <SettingsPageLayout resetKey="connection">
      <ConnectionSettingsConnection
        key={retryVersion}
        onRetry={() => setRetryVersion((version) => version + 1)}
      />
    </SettingsPageLayout>
  )
}

function ConnectionSettingsConnection({ onRetry }: { onRetry: () => void }) {
  const [client, setClient] = useState<ReturnType<typeof createConnectionClient> | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const profileId =
    new URLSearchParams(window.location.search).get('connection') ??
    sessionStorage.getItem('codex-web:active-connection-profile') ??
    undefined
  const {
    status: ownerStatus,
    error: ownerError,
    isRemote,
    request: ownerRequest,
    close: closeOwnerRuntime,
  } = useOwnerRuntime(profileId)
  const requirePasskeyStepUp = isRemote && Boolean(profileId)
  const requestOwner = useCallback(
    <T = unknown,>(method: string, params?: Record<string, unknown>) =>
      ownerRequest<T>(method, params),
    [ownerRequest],
  )
  const closeOwner = useCallback(() => closeOwnerRuntime('management closed'), [closeOwnerRuntime])
  useEffect(() => {
    if (ownerStatus === 'ready') {
      setConnectionError(null)
      setClient(
        createConnectionClient({
          request: requestOwner,
          close: closeOwner,
          requirePasskeyStepUp,
        }),
      )
    } else {
      setClient(null)
      if (ownerStatus === 'failed') {
        setConnectionError(ownerError ?? 'Owner connection failed')
      } else {
        setConnectionError(null)
      }
    }
  }, [closeOwner, ownerError, requestOwner, ownerStatus, requirePasskeyStepUp])
  return (
    <>
      {connectionError ? (
        <SettingsPageError message={connectionError} onRetry={onRetry} />
      ) : client ? (
        <ConnectionScreen client={client} />
      ) : (
        <SettingsPageDelayedLoading message="Connecting to Owner..." />
      )}
    </>
  )
}

export function ConnectionRoute() {
  const navigate = useNavigate()
  const [sidebarWidth, setSidebarWidth] = useState(readWorkspaceSidebarWidth)
  const handleSidebarWidthChange = useCallback((width: number) => {
    setSidebarWidth(width)
    storeWorkspaceSidebarWidth(width)
  }, [])

  return (
    <div className="app-shell relative flex h-svh max-h-svh w-full touch-pan-x overflow-hidden overscroll-none bg-sidebar">
      <MobileWorkspaceNavigation sidebarWidth={sidebarWidth}>
        <SettingsSidebar
          archivedActive={false}
          connectionActive
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={handleSidebarWidthChange}
          onBack={() => void navigate('/app')}
          onGeneral={() => void navigate('/app/settings')}
          onConnection={() => undefined}
          onArchived={() => void navigate('/app/settings/archived-chats')}
        />
      </MobileWorkspaceNavigation>
      <main className="app-main min-h-0 min-w-0 flex-1 overflow-hidden bg-app-surface">
        <ConnectionSettingsContent />
      </main>
    </div>
  )
}
