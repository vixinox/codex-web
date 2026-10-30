import * as React from 'react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { toast } from '@/components/ui/toast'
import { readLocalOwnerSession } from '@/lib/auth/auth-client'
import { LoginScreen } from '@/app/composition/screens/login-screen'
import { WorkspaceShell } from '@/app/composition/workspace-shell'
import { useCodexRuntimeController } from '@/app/workspace/runtime/use-codex-runtime-controller'
import { CodexLogo } from '@/components/shared/codex-logo'
import { OwnerManageScreen } from '@/app/owner/owner-manage-screen'
import { createOwnerManagementClient } from '@/app/owner/owner-management-client'
import { useOwnerRuntime } from '@/lib/owner-ws/use-owner-runtime'
import { loadDeviceKey, loadRemoteOwnerSession } from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'
import { createOwnerRuntime } from '@/lib/owner-ws/owner-runtime'

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
  return <Navigate to={readLocalOwnerSession() ? '/app' : '/login'} replace />
}

export function CandidateRoute() {
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

  if (!remoteChecked) return pageFallback
  const stateOwnerId = (location.state as { remoteOwnerId?: unknown } | null)?.remoteOwnerId
  const localSession = readLocalOwnerSession()
  const ownerId = remoteOwnerId ?? stateOwnerId ?? localSession?.ownerId
  if (typeof ownerId !== 'string') return <Navigate to="/login" replace />

  return <AuthenticatedWorkspace userId={ownerId} sessionToken={localSession?.token} />
}

export function AuthenticatedWorkspace({
  userId,
  sessionToken,
}: {
  userId: string
  sessionToken?: string
}) {
  const { status, error } = useOwnerRuntime(sessionToken)
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
  return <LoginScreen />
}

export function OwnerManageRoute() {
  const [client, setClient] = useState<ReturnType<typeof createOwnerManagementClient> | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const {
    status: ownerStatus,
    error: ownerError,
    request: ownerRequest,
    close: closeOwnerRuntime,
  } = useOwnerRuntime(readLocalOwnerSession()?.token)
  const [remoteCredentials, setRemoteCredentials] = useState<{
    token: string
    ownerId: string
    relayUrl: string
    nodeId: string
    deviceId: string
    trustEpoch: number
    clientToken: string
    publicKey: string
    privateKey: CryptoKey
  } | null>(null)
  const remoteRuntimeRef = React.useRef<ReturnType<typeof createOwnerRuntime> | null>(null)
  useEffect(() => {
    if (readLocalOwnerSession()) return
    let active = true
    void (async () => {
      const record = await loadDeviceKey()
      if (
        !record?.pairedClientToken ||
        !record.deviceId ||
        !record.nodeId ||
        !record.relayUrl ||
        !record.ownerCode
      )
        return
      const session = await loadRemoteOwnerSession({
        relayUrl: record.relayUrl,
        ownerCode: record.ownerCode,
        nodeId: record.nodeId,
        deviceId: record.deviceId,
        ownerId: record.ownerId ?? undefined,
      })
      if (!session || !active) return
      setRemoteCredentials({
        token: session.token,
        ownerId: session.ownerId,
        relayUrl: record.relayUrl,
        nodeId: record.nodeId,
        deviceId: record.deviceId,
        trustEpoch: record.trustEpoch ?? 0,
        clientToken: record.pairedClientToken,
        publicKey: record.publicKey,
        privateKey: record.privateKey,
      })
    })().catch((cause) => {
      if (active)
        setConnectionError(
          cause instanceof Error ? cause.message : 'Unable to restore remote session',
        )
    })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!remoteCredentials || readLocalOwnerSession()) return
    const runtime = createOwnerRuntime((url) =>
      createRelayOwnerSocket(url, {
        nodeId: remoteCredentials.nodeId,
        trustEpoch: remoteCredentials.trustEpoch,
        clientToken: remoteCredentials.clientToken,
        deviceId: remoteCredentials.deviceId,
        publicKey: remoteCredentials.publicKey,
        privateKey: remoteCredentials.privateKey,
      }),
    )
    remoteRuntimeRef.current = runtime
    let active = true
    void runtime
      .connect({
        url: remoteCredentials.relayUrl,
        sessionToken: remoteCredentials.token,
        clientId: 'owner-management',
        capabilities: ['owner', 'remote-administration'],
      })
      .then(() => {
        if (!active) return
        setClient(
          createOwnerManagementClient({
            request: (method: string, params?: Record<string, unknown>) =>
              runtime.request(method, params),
            close: () => runtime.close('management closed'),
          }),
        )
      })
      .catch((cause) => {
        if (active)
          setConnectionError(cause instanceof Error ? cause.message : 'Unable to connect to Owner')
      })
    return () => {
      active = false
      runtime.close('management route disposed')
      remoteRuntimeRef.current = null
    }
  }, [remoteCredentials])
  const requestOwner = useCallback(
    (method: string, params?: Record<string, unknown>) => ownerRequest(method, params),
    [ownerRequest],
  )
  const closeOwner = useCallback(() => closeOwnerRuntime('management closed'), [closeOwnerRuntime])
  useEffect(() => {
    if (!readLocalOwnerSession()) return
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
