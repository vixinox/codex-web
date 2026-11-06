import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { readLocalOwnerSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { OwnerManageScreen } from '@/app/owner/owner-manage-screen'
import { createOwnerManagementClient } from '@/app/owner/owner-management-client'
import { useOwnerRuntime } from '@/lib/owner-ws/use-owner-runtime'
import {
  completeConnectionProfile,
  createConnectionProfileDraft,
  loadConnectionProfileSession,
  removeConnectionProfile,
} from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'
import { remoteRelayUrl } from '@/lib/remote/relay-profile'
import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'
import { presentAppError } from '@/lib/errors/presentation'
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

export const pageFallback = <div className="min-h-svh bg-background" aria-label="Loading page" />

const enrollmentAttempts = new Map<string, Promise<{ ownerId: string; profileId: string }>>()

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
  const localSession = readLocalOwnerSession()
  const connectionProfileId = sessionStorage.getItem('codex-web:active-connection-profile')
  if (connectionProfileId)
    return <Navigate to={`/app?connection=${encodeURIComponent(connectionProfileId)}`} replace />
  return <Navigate to={localSession ? '/app' : '/login'} replace />
}

export function CandidateRoute() {
  const location = useLocation()
  const [remoteOwnerId, setRemoteOwnerId] = useState<string | null>(null)
  const [remoteChecked, setRemoteChecked] = useState(false)
  const routeState = location.state as {
    remoteOwnerId?: unknown
    connectionProfileId?: unknown
  } | null
  const profileId =
    typeof routeState?.connectionProfileId === 'string'
      ? routeState.connectionProfileId
      : (new URLSearchParams(location.search).get('connection') ??
        sessionStorage.getItem('codex-web:active-connection-profile') ??
        undefined)
  const localSession = readLocalOwnerSession()
  useEffect(() => {
    if (localSession && !profileId) {
      setRemoteOwnerId(localSession.ownerId)
      setRemoteChecked(true)
      return
    }
    if (profileId) {
      void loadConnectionProfileSession(profileId)
        .then((session) => {
          setRemoteOwnerId(session?.ownerId ?? null)
          if (
            !session &&
            sessionStorage.getItem('codex-web:active-connection-profile') === profileId
          )
            sessionStorage.removeItem('codex-web:active-connection-profile')
          return undefined
        })
        .catch(() => {
          setRemoteOwnerId(null)
          return undefined
        })
        .finally(() => setRemoteChecked(true))
      return
    }
    setRemoteOwnerId(null)
    setRemoteChecked(true)
    return
  }, [localSession, profileId])

  if (!isKnownAppRoute(location.pathname)) return <Navigate to="/app" replace />
  if (!remoteChecked) return pageFallback
  const stateOwnerId = routeState?.remoteOwnerId
  const ownerId = profileId ? remoteOwnerId : (stateOwnerId ?? localSession?.ownerId)
  if (typeof ownerId !== 'string') return <Navigate to="/login" replace />

  return (
    <AuthenticatedWorkspace
      userId={ownerId}
      sessionToken={profileId ? undefined : localSession?.token}
      connectionProfileId={profileId}
    />
  )
}

export function AuthenticatedWorkspace({
  userId,
  sessionToken,
  connectionProfileId,
}: {
  userId: string
  sessionToken?: string
  connectionProfileId?: string
}) {
  const { status, error } = useOwnerRuntime(sessionToken, connectionProfileId)
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
  if (readLocalOwnerSession()) return <Navigate to="/app" replace />
  if (sessionStorage.getItem('codex-web:active-connection-profile'))
    return <Navigate to="/app" replace />
  return <LoginScreen />
}

export function EnrollmentRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const params = new URLSearchParams(location.search)
    const reference = params.get('ref')
    const hasUnexpectedParameter = [...params.keys()].some((key) => key !== 'ref')
    if (hasUnexpectedParameter || !reference || !/^[A-Za-z0-9_-]{16,256}$/u.test(reference)) {
      setError('This enrollment link is invalid.')
      return () => {
        active = false
      }
    }

    setError(null)
    void (async () => {
      try {
        const result = await redeemEnrollmentOnce(reference)
        if (!active) return
        sessionStorage.setItem('codex-web:active-connection-profile', result.profileId)
        await navigate(`/app?connection=${encodeURIComponent(result.profileId)}`, {
          replace: true,
          state: { remoteOwnerId: result.ownerId, connectionProfileId: result.profileId },
        })
      } catch (cause) {
        if (!active) return
        setError(presentAppError(cause, 'Device enrollment failed.'))
      }
    })()

    return () => {
      active = false
    }
  }, [location.search, navigate, retry])

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-md space-y-4 rounded-md border bg-card p-6 text-center shadow-sm">
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Unable to add this browser</h1>
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setError(null)
                  setRetry((value) => value + 1)
                }}
              >
                Try again
              </Button>
              <Button variant="ghost" onClick={() => void navigate('/login', { replace: true })}>
                Open login
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3" role="status" aria-live="polite">
            <Loader2 className="mx-auto size-6 animate-spin" aria-hidden="true" />
            <h1 className="text-lg font-semibold">Adding this browser</h1>
            <p className="text-sm text-muted-foreground">
              This one-time invitation is being used to add this browser.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

function redeemEnrollmentOnce(reference: string) {
  const existing = enrollmentAttempts.get(reference)
  if (existing) return existing
  const attempt = redeemEnrollment(reference).finally(() => enrollmentAttempts.delete(reference))
  enrollmentAttempts.set(reference, attempt)
  return attempt
}

async function redeemEnrollment(
  reference: string,
): Promise<{ ownerId: string; profileId: string }> {
  const relayUrl = remoteRelayUrl()
  const draft = await createConnectionProfileDraft({ label: 'Owner connection', relayUrl })
  const runtime = createOwnerRuntime(() =>
    createRelayOwnerSocket(relayUrl, {
      clientToken: '',
      publicKey: draft.publicKey,
      privateKey: draft.privateKey,
      enrollmentReference: reference,
    }),
  )
  try {
    await runtime.connect({ url: relayUrl, clientId: 'owner-enrollment', capabilities: ['owner'] })
    const result = await runtime.request<{
      ownerId: string
      nodeId: string
      ownerPublicKey: string
      deviceId: string
      clientToken: string
      trustEpoch: number
      sessionToken: string
      expiresAt: string
    }>('owner.enrollment.redeem', { reference }, { timeoutMs: 10_000 })
    if (
      typeof result.ownerId !== 'string' ||
      typeof result.nodeId !== 'string' ||
      typeof result.ownerPublicKey !== 'string' ||
      typeof result.deviceId !== 'string' ||
      typeof result.clientToken !== 'string' ||
      !Number.isSafeInteger(result.trustEpoch) ||
      typeof result.sessionToken !== 'string' ||
      typeof result.expiresAt !== 'string'
    )
      throw new Error('Owner returned an invalid enrollment result.')
    await completeConnectionProfile({
      id: draft.id,
      nodeId: result.nodeId,
      ownerId: result.ownerId,
      ownerPublicKey: result.ownerPublicKey,
      deviceId: result.deviceId,
      pairedClientToken: result.clientToken,
      trustEpoch: result.trustEpoch,
      sessionToken: result.sessionToken,
      sessionExpiresAt: result.expiresAt,
    })
    return { ownerId: result.ownerId, profileId: draft.id }
  } catch (cause) {
    await removeConnectionProfile(draft.id).catch(() => undefined)
    throw cause
  } finally {
    runtime.close('enrollment complete')
  }
}

export function OwnerManageRoute() {
  const [retryVersion, setRetryVersion] = useState(0)

  return (
    <SettingsPageLayout resetKey="connection" pageTitle="Connection">
      <OwnerManageConnection
        key={retryVersion}
        onRetry={() => setRetryVersion((version) => version + 1)}
      />
    </SettingsPageLayout>
  )
}

function OwnerManageConnection({ onRetry }: { onRetry: () => void }) {
  const [client, setClient] = useState<ReturnType<typeof createOwnerManagementClient> | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const profileId =
    new URLSearchParams(window.location.search).get('connection') ??
    sessionStorage.getItem('codex-web:active-connection-profile') ??
    undefined
  const localSession = readLocalOwnerSession()
  const {
    status: ownerStatus,
    error: ownerError,
    request: ownerRequest,
    close: closeOwnerRuntime,
  } = useOwnerRuntime(localSession?.token, profileId)
  const requirePasskeyStepUp = !localSession && Boolean(profileId)
  const requestOwner = useCallback(
    <T = unknown,>(method: string, params?: Record<string, unknown>) =>
      ownerRequest<T>(method, params),
    [ownerRequest],
  )
  const closeOwner = useCallback(() => closeOwnerRuntime('management closed'), [closeOwnerRuntime])
  useEffect(() => {
    let timer: number | undefined
    if (ownerStatus === 'ready') {
      setConnectionError(null)
      setClient(
        createOwnerManagementClient({
          request: requestOwner,
          close: closeOwner,
          requirePasskeyStepUp,
        }),
      )
    } else {
      setClient(null)
      if (ownerStatus === 'failed') {
        timer = window.setTimeout(
          () => setConnectionError(ownerError ?? 'Owner connection failed'),
          400,
        )
      } else {
        setConnectionError(null)
      }
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [closeOwner, ownerError, requestOwner, ownerStatus, requirePasskeyStepUp])
  return (
    <>
      {connectionError ? (
        <SettingsPageError message={connectionError} onRetry={onRetry} />
      ) : client ? (
        <OwnerManageScreen client={client} />
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
      <main className="app-main min-h-0 min-w-0 flex-1 overflow-auto bg-app-surface">
        <OwnerManageRoute />
      </main>
    </div>
  )
}
