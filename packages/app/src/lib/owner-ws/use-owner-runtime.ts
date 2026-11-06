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
import {
  clearConnectionProfileSession,
  loadConnectionProfile,
  loadConnectionProfileSession,
} from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'
import { presentAppError } from '@/lib/errors/presentation'

export type OwnerRuntimeController = {
  status: 'idle' | 'connecting' | 'ready' | 'remote-unavailable' | 'failed'
  error: string | null
  isRemote: boolean
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
export function useOwnerRuntime(
  sessionToken: string | undefined,
  connectionProfileId?: string,
): OwnerRuntimeController {
  const key = sessionToken
    ? `local:${sessionToken}`
    : connectionProfileId
      ? `remote-profile:${connectionProfileId}`
      : 'remote-paired'
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
  const status: OwnerRuntimeController['status'] =
    snapshot.transport === 'connected'
      ? 'ready'
      : snapshot.transport === 'connecting' || snapshot.transport === 'reconnecting'
        ? 'connecting'
        : snapshot.transport === 'failed'
          ? 'failed'
          : !sessionToken
            ? 'remote-unavailable'
            : 'idle'
  const error = snapshot.error

  React.useEffect(() => {
    if (!sessionToken && !connectionProfileId && key !== 'remote-paired') return
    const pendingDisposal = runtimeDisposalTimers.get(runtime)
    if (pendingDisposal !== undefined) {
      window.clearTimeout(pendingDisposal)
      runtimeDisposalTimers.delete(runtime)
    }
    let active = true
    const connectionAbort = new AbortController()
    const unsubscribe = runtime.subscribe(() => {
      if (!active) return
      setSnapshot({ ...runtime.state })
      if (runtime.state.transport === 'connected') setOwnerBridge(runtime)
      if (runtime.state.transport === 'failed' && runtime.state.reconnectAttempt === 0) {
        setOwnerBridge(null)
        setConnectionRevision((revision) => revision + 1)
      }
    })
    const unsubscribeNotification = runtime.subscribeNotification((method) => {
      if (!active || method !== 'remote.device.revoked') return
      if (connectionProfileId)
        void clearConnectionProfileSession(connectionProfileId).catch(() => undefined)
    })
    const connect = async () => {
      if (sessionToken) {
        await runtime.connect({
          url: `${window.location.origin.replace(/^http/, 'ws')}/ws`,
          sessionToken,
          clientId: 'owner-app',
          capabilities: ['owner', 'remote-administration'],
        })
        return
      }
      if (connectionProfileId) {
        const profile = await loadConnectionProfile(connectionProfileId)
        const session = await loadConnectionProfileSession(connectionProfileId)
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
        remoteSocketBuilderRef.current = () =>
          createRelayOwnerSocket(profile.relayUrl, socketTarget)
        await runtime.connect({
          url: profile.relayUrl,
          sessionToken: session.token,
          clientId: 'owner-remote-app',
          capabilities: ['owner', 'remote-administration'],
        })
        await runtime.waitForConnection(connectionAbort.signal)
        return
      }
      return
    }
    // React StrictMode replays effects in development. Deferring connection start lets the
    // first setup be cancelled during that replay instead of opening a socket that cleanup
    // immediately closes before its handshake completes.
    const connectTimer = window.setTimeout(() => {
      void connect()
        .then(() => {
          if (!active) return undefined
          setOwnerBridge(runtime)
          return undefined
        })
        .catch((cause: unknown) => {
          if (!active) return undefined
          setSnapshot({
            ...runtime.state,
            error: presentAppError(cause, 'Owner connection failed'),
          })
          return undefined
        })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(connectTimer)
      connectionAbort.abort()
      unsubscribe()
      unsubscribeNotification()
      setOwnerBridge(null)
      // StrictMode's development-only cleanup is followed immediately by another setup.
      // Defer destruction for one task so the replay can reuse the live controller.
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
  }, [connectionProfileId, key, runtime, sessionToken, connectionRevision])

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
    isRemote: key === 'remote-paired' || key.startsWith('remote-profile:'),
    request,
    openStream,
    close,
  }
}
