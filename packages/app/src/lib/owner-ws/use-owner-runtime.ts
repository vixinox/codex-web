import * as React from 'react'
import {
  createOwnerRuntime,
  type RequestOptions,
  type StreamHandle,
  type StreamHandlers,
  type StreamRequest,
} from './owner-runtime'
import {
  createOwnerRuntimeController,
  type OwnerRuntimeController as SessionController,
} from './runtime-controller'
import { setOwnerBridge } from '@/lib/bridge/owner-runtime'
import { loadConnectionProfile, loadConnectionProfileSession } from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'
import { AUTH_EXPIRED_EVENT } from '@/lib/auth/auth-expiry'
import { presentAppError } from '@/lib/errors/presentation'
import { ownerTargetKind } from './target'

export type OwnerRuntimeController = {
  status: 'idle' | 'connecting' | 'ready' | 'remote-unavailable' | 'failed'
  error: string | null
  isRemote: boolean
  ownerId: string | null
  request: <T = unknown>(
    this: void,
    method: string,
    params?: unknown,
    options?: RequestOptions,
  ) => Promise<T>
  openStream: (this: void, request: StreamRequest, handlers: StreamHandlers) => StreamHandle
  close: (this: void, reason?: string) => void
}

const runtimes = new Map<string, SessionController>()
const runtimeDisposalTimers = new Map<SessionController, number>()

export function useOwnerRuntime(connectionProfileId?: string): OwnerRuntimeController {
  const targetKind = ownerTargetKind(window.location.origin)
  const local = targetKind === 'local'
  const selectedProfileId = local ? undefined : connectionProfileId
  const key = local
    ? `local:${window.location.origin}`
    : selectedProfileId
      ? `remote-profile:${selectedProfileId}`
      : 'remote-unavailable'
  const active = local || selectedProfileId !== undefined
  const remoteSocketRef = React.useRef<WebSocket | null>(null)
  const remoteSocketBuilderRef = React.useRef<(() => WebSocket) | null>(null)
  const [connectionRevision, setConnectionRevision] = React.useState(0)
  const runtime = React.useMemo(() => {
    const existing = runtimes.get(key)
    if (existing) return existing
    const created = createOwnerRuntimeController(
      createOwnerRuntime((url) => {
        if (remoteSocketRef.current && remoteSocketRef.current.readyState < WebSocket.CLOSING)
          return remoteSocketRef.current
        const next = remoteSocketBuilderRef.current?.() ?? new WebSocket(url)
        remoteSocketRef.current = next
        return next
      }),
    )
    runtimes.set(key, created)
    return created
  }, [key])
  const [snapshot, setSnapshot] = React.useState(() => ({ ...runtime.state }))
  const authenticated =
    snapshot.transport === 'connected' && snapshot.authentication === 'authenticated'
  const status: OwnerRuntimeController['status'] = !active
    ? 'remote-unavailable'
    : authenticated
      ? 'ready'
      : snapshot.transport === 'connecting' ||
          snapshot.transport === 'reconnecting' ||
          (snapshot.transport === 'failed' && snapshot.reconnectAttempt > 0)
        ? 'connecting'
        : snapshot.transport === 'failed'
          ? 'failed'
          : snapshot.transport === 'connected'
            ? 'failed'
            : 'idle'
  const error =
    status === 'failed'
      ? (snapshot.error ??
        (local ? 'Local Owner access was rejected.' : 'Remote session is not authenticated.'))
      : null

  React.useEffect(() => {
    if (!active) return
    const pendingDisposal = runtimeDisposalTimers.get(runtime)
    if (pendingDisposal !== undefined) {
      window.clearTimeout(pendingDisposal)
      runtimeDisposalTimers.delete(runtime)
    }
    let live = true
    let rejectionHandled = false
    const connectionAbort = new AbortController()
    const rejectRemote = () => {
      if (rejectionHandled || local || !selectedProfileId) return
      rejectionHandled = true
      window.dispatchEvent(
        new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { profileId: selectedProfileId } }),
      )
    }
    const unsubscribe = runtime.subscribe(() => {
      if (!live) return
      const current = runtime.state
      setSnapshot({ ...current })
      if (current.transport === 'connected' && current.authentication === 'authenticated') {
        setOwnerBridge(runtime)
      } else {
        setOwnerBridge(null)
        if (current.transport === 'connected' && current.authentication === 'unauthenticated')
          rejectRemote()
      }
      if (
        current.transport === 'failed' &&
        current.authentication !== 'revoked' &&
        current.reconnectAttempt === 0
      ) {
        setOwnerBridge(null)
        if (runtime.isAuthenticationRejection()) rejectRemote()
        setConnectionRevision((revision) => revision + 1)
      }
    })
    const connect = async () => {
      if (local) {
        await runtime.connect({
          url: `${window.location.origin.replace(/^http/u, 'ws')}/ws`,
          clientId: 'owner-app',
          capabilities: ['owner', 'remote-administration'],
        })
        if (!runtime.state.authentication || runtime.state.authentication !== 'authenticated')
          throw new Error('Local Owner access was rejected.')
        return
      }
      if (!selectedProfileId) return
      const profile = await loadConnectionProfile(selectedProfileId)
      const session = await loadConnectionProfileSession(selectedProfileId)
      if (
        !profile?.deviceId ||
        !profile.pairedClientToken ||
        profile.trustEpoch === null ||
        !session
      )
        throw new Error('Saved connection is unavailable. Re-enroll this browser.')
      const socketTarget = {
        nodeId: profile.nodeId,
        trustEpoch: profile.trustEpoch,
        clientToken: profile.pairedClientToken,
        deviceId: profile.deviceId,
        publicKey: profile.publicKey,
        privateKey: profile.privateKey,
        expectedOwnerPublicKey: profile.ownerPublicKey,
      }
      remoteSocketRef.current = createRelayOwnerSocket(profile.relayUrl, socketTarget)
      remoteSocketBuilderRef.current = () => createRelayOwnerSocket(profile.relayUrl, socketTarget)
      await runtime.connect({
        url: profile.relayUrl,
        sessionToken: session.token,
        clientId: 'owner-remote-app',
        capabilities: ['owner', 'remote-administration'],
      })
      if (runtime.state.authentication !== 'authenticated') {
        rejectRemote()
        throw new Error('Remote session is not authenticated.')
      }
    }
    const connectTimer = window.setTimeout(() => {
      void connect()
        .then(() => {
          if (live && runtime.state.authentication === 'authenticated') setOwnerBridge(runtime)
          return undefined
        })
        .catch((cause: unknown) => {
          if (!live) return undefined
          setOwnerBridge(null)
          if (runtime.state.reconnectAttempt > 0) return undefined
          setSnapshot({
            ...runtime.state,
            error: presentAppError(cause, 'Owner connection failed'),
          })
          return undefined
        })
    }, 0)
    return () => {
      live = false
      window.clearTimeout(connectTimer)
      connectionAbort.abort()
      unsubscribe()
      setOwnerBridge(null)
      const disposalTimer = window.setTimeout(() => {
        runtimeDisposalTimers.delete(runtime)
        if (runtimes.get(key) === runtime) {
          runtime.close('route disposed')
          runtimes.delete(key)
        }
        remoteSocketRef.current?.close()
        remoteSocketRef.current = null
        remoteSocketBuilderRef.current = null
      }, 0)
      runtimeDisposalTimers.set(runtime, disposalTimer)
    }
  }, [active, key, local, runtime, selectedProfileId, connectionRevision])

  const request = React.useCallback<OwnerRuntimeController['request']>(
    (method, params, options) => runtime.request(method, params, options),
    [runtime],
  )
  const openStream = React.useCallback<OwnerRuntimeController['openStream']>(
    (streamRequest, handlers) => runtime.openStream(streamRequest, handlers),
    [runtime],
  )
  const close = React.useCallback<OwnerRuntimeController['close']>(
    (reason) => runtime.close(reason),
    [runtime],
  )

  return {
    status,
    error,
    isRemote: !local,
    ownerId: authenticated ? snapshot.ownerId : null,
    request,
    openStream,
    close,
  }
}
