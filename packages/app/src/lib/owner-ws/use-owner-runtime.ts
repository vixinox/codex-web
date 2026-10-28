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
  clearDeviceKey,
  loadDeviceKey,
  loadRemoteOwnerSession,
} from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'

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
export function useOwnerRuntime(sessionToken: string | undefined): OwnerRuntimeController {
  const key = sessionToken ? `local:${sessionToken}` : 'remote-paired'
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
    if (!sessionToken && key !== 'remote-paired') return
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
      void clearDeviceKey().catch(() => undefined)
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
      const record = await loadDeviceKey()
      if (!record?.pairedClientToken || !record.deviceId || !record.nodeId || !record.relayUrl)
        return
      const pairedDeviceId = record.deviceId
      const socketTarget = {
        nodeId: record.nodeId,
        trustEpoch: record.trustEpoch ?? 0,
        clientToken: record.pairedClientToken,
        deviceId: pairedDeviceId,
        publicKey: record.publicKey,
        privateKey: record.privateKey,
      }
      const socketUrl = record.relayUrl
      remoteSocketRef.current = createRelayOwnerSocket(socketUrl, socketTarget)
      remoteSocketBuilderRef.current = () => createRelayOwnerSocket(socketUrl, socketTarget)
      const savedSession = record.ownerCode
        ? await loadRemoteOwnerSession({
            relayUrl: record.relayUrl,
            ownerCode: record.ownerCode,
            nodeId: record.nodeId,
            deviceId: pairedDeviceId,
            ownerId: record.ownerId ?? undefined,
          })
        : null
      await runtime.connect({
        url: record.relayUrl,
        ...(savedSession ? { sessionToken: savedSession.token } : {}),
        clientId: 'owner-remote-app',
        capabilities: ['owner', 'remote-administration'],
      })
      await runtime.waitForConnection(connectionAbort.signal)
    }
    // React StrictMode replays effects in development. Deferring connection start lets the
    // first setup be cancelled during that replay instead of opening a socket that cleanup
    // immediately closes before its handshake completes.
    const connectTimer = window.setTimeout(() => {
      void connect()
        .then(() => {
          if (!active) return
          setOwnerBridge(runtime)
        })
        .catch((cause: unknown) => {
          if (!active) return
          setSnapshot({
            ...runtime.state,
            error: cause instanceof Error ? cause.message : 'Owner connection failed',
          })
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
  }, [key, runtime, sessionToken, connectionRevision])

  return {
    status,
    error,
    isRemote: key === 'remote-paired',
    request: (method, params, options) => runtime.request(method, params, options),
    openStream: (request, handlers) => runtime.openStream(request, handlers),
    close: (reason) => runtime.close(reason),
  }
}
