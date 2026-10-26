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
import { getRemoteBootstrap } from '@/app/entry/bootstrap'
import {
  createDeviceKey,
  clearPairedDevice,
  loadDeviceKey,
  setPairedDevice,
  setRemoteTarget,
} from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'
import {
  authenticateRemoteDevice,
  completeProvisionalTwoFactor,
  openProvisionalSession,
  promoteProvisionalDevice,
  type PairedAdmission,
  type ProvisionalLogin,
} from '@/lib/remote/admission'

export type OwnerRuntimeController = {
  status: 'idle' | 'connecting' | 'ready' | 'remote-unavailable' | 'failed'
  error: string | null
  isRemote: boolean
  request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T>
  openStream(request: StreamRequest, handlers: StreamHandlers): StreamHandle
  close(reason?: string): void
  authenticateRemoteDevice(input: {
    credentials: ProvisionalLogin
    factor?:
      | { kind: 'totp' | 'recovery'; code: string }
      | { kind: 'approval'; code?: string; codeKind?: 'totp' | 'recovery' }
  }): Promise<
    { ownerId: string; sessionToken: string } | (PairedAdmission & { sessionToken: string })
  >
}

const runtimes = new Map<string, SessionController>()
const runtimeDisposalTimers = new Map<SessionController, number>()
const PAIRING_TIMEOUT_MS = 30 * 60 * 1_000

export function useOwnerRuntime(sessionToken: string | undefined): OwnerRuntimeController {
  const remote = getRemoteBootstrap()
  const key = remote
    ? `remote:${remote.bootstrapId}`
    : sessionToken
      ? `local:${sessionToken}`
      : 'remote-paired'
  const remoteSocketRef = React.useRef<WebSocket | null>(null)
  const remoteSocketBuilderRef = React.useRef<(() => WebSocket) | null>(null)
  const pairingWaitersRef = React.useRef(
    new Set<{
      resolve: (session: { ownerId: string; sessionToken: string }) => void
      reject: (error: Error) => void
      session: { ownerId: string; sessionToken: string }
      settled: boolean
    }>(),
  )
  const pairingNotificationRef = React.useRef(false)
  const pairedAdmissionsRef = React.useRef(
    new Map<
      string,
      | { status: 'pending' }
      | { status: 'fulfilled'; session: { ownerId: string; sessionToken: string } }
      | { status: 'rejected'; error: Error }
    >(),
  )
  const approvalSessionRef = React.useRef<{ ownerId: string; sessionToken: string } | null>(null)
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
          : remote || !sessionToken
            ? 'remote-unavailable'
            : 'idle'
  const error = snapshot.error

  React.useEffect(() => {
    if (!sessionToken && !remote && key !== 'remote-paired') return
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
    const unsubscribeNotification = runtime.subscribeNotification((method, params) => {
      if (!active || method !== 'remote.device.paired' || !remote || !isRecord(params)) return
      const deviceId = params.deviceId
      const clientToken = params.clientToken
      if (typeof deviceId !== 'string' || typeof clientToken !== 'string') return
      const notificationKey = `${deviceId}:${clientToken}`
      if (pairedAdmissionsRef.current.has(notificationKey)) return
      if (pairingNotificationRef.current) return
      pairedAdmissionsRef.current.set(notificationKey, { status: 'pending' })
      pairingNotificationRef.current = true
      void (async () => {
        const record = await loadDeviceKey()
        if (!active || !record) throw new Error('Remote device key is unavailable.')
        await setPairedDevice({
          deviceId,
          pairedClientToken: clientToken,
          trustEpoch: remote.trustEpoch,
          nodeId: remote.nodeId,
          relayUrl: remote.relayUrl,
        })
        const paired = await loadDeviceKey()
        if (!active || !paired?.pairedClientToken || !paired.deviceId)
          throw new Error('Paired device could not be stored.')
        const socketTarget = {
          nodeId: remote.nodeId,
          trustEpoch: paired.trustEpoch ?? remote.trustEpoch,
          clientToken: paired.pairedClientToken,
          deviceId: paired.deviceId,
          publicKey: paired.publicKey,
          privateKey: paired.privateKey,
        }
        remoteSocketRef.current?.close()
        remoteSocketRef.current = createRelayOwnerSocket(remote.relayUrl, socketTarget)
        remoteSocketBuilderRef.current = () => createRelayOwnerSocket(remote.relayUrl, socketTarget)
        if (!approvalSessionRef.current) throw new Error('Remote sign-in session is unavailable.')
        await runtime.switchTarget({
          url: remote.relayUrl,
          clientId: 'owner-remote-app',
          capabilities: ['owner', 'remote-administration'],
          sessionToken: approvalSessionRef.current?.sessionToken,
        })
        await runtime.waitForConnection(connectionAbort.signal)
        if (runtime.state.authentication !== 'authenticated')
          throw new Error('Paired Owner admission was rejected.')
        const session = approvalSessionRef.current
        if (!session) throw new Error('Remote sign-in session is unavailable.')
        approvalSessionRef.current = null
        for (const waiter of pairingWaitersRef.current) {
          if (waiter.settled) continue
          waiter.settled = true
          pairingWaitersRef.current.delete(waiter)
          waiter.resolve(session)
        }
        pairedAdmissionsRef.current.set(notificationKey, { status: 'fulfilled', session })
        setConnectionRevision((revision) => revision + 1)
      })()
        .catch((cause: unknown) => {
          const pairingError = cause instanceof Error ? cause : new Error('Remote pairing failed.')
          pairedAdmissionsRef.current.set(notificationKey, {
            status: 'rejected',
            error: pairingError,
          })
          void (async () => {
            if (runtime.isAuthenticationRejection())
              await clearPairedDevice().catch(() => undefined)
            setSnapshot({ ...runtime.state, error: pairingError.message })
            setConnectionRevision((revision) => revision + 1)
            for (const waiter of pairingWaitersRef.current) {
              if (waiter.settled) continue
              waiter.settled = true
              pairingWaitersRef.current.delete(waiter)
              waiter.reject(pairingError)
            }
          })().catch(() => undefined)
        })
        .finally(() => {
          pairingNotificationRef.current = false
        })
    })
    const connect = async () => {
      if (!remote && sessionToken) {
        await runtime.connect({
          url: `${window.location.origin.replace(/^http/, 'ws')}/ws`,
          sessionToken,
          clientId: 'owner-app',
          capabilities: ['owner', 'remote-administration'],
        })
        return
      }
      let record = await loadDeviceKey()
      let target = remote
      if (remote) {
        if (!record) {
          await createDeviceKey()
          record = await loadDeviceKey()
        }
        if (!record) throw new Error('Unable to create a remote device key')
        await setRemoteTarget({ nodeId: remote.nodeId, relayUrl: remote.relayUrl })
      } else if (record?.pairedClientToken && record.nodeId && record.relayUrl) {
        target = {
          bootstrapId: '',
          nodeId: record.nodeId,
          trustEpoch: record.trustEpoch ?? 0,
          relayUrl: record.relayUrl,
          clientToken: record.pairedClientToken,
        }
      } else return
      if (!record || !target) throw new Error('Remote device key is missing')
      const pairedClientToken = record.pairedClientToken
      const pairedDeviceId = record.deviceId
      const paired = Boolean(pairedClientToken && pairedDeviceId)
      const token = pairedClientToken ?? target.clientToken
      const socketTarget = {
        nodeId: target.nodeId,
        trustEpoch: record.trustEpoch ?? target.trustEpoch,
        clientToken: token,
        ...(paired ? { deviceId: pairedDeviceId! } : { bootstrapId: target.bootstrapId }),
        publicKey: record.publicKey,
        privateKey: record.privateKey,
      }
      const socketUrl = target.relayUrl
      remoteSocketRef.current = createRelayOwnerSocket(socketUrl, socketTarget)
      remoteSocketBuilderRef.current = () => createRelayOwnerSocket(socketUrl, socketTarget)
      await runtime.connect({
        url: target.relayUrl,
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
        for (const waiter of pairingWaitersRef.current) {
          if (waiter.settled) continue
          waiter.settled = true
          waiter.reject(new Error('Remote pairing was cancelled.'))
        }
        pairingWaitersRef.current.clear()
        if (runtimes.get(key) === runtime) {
          runtime.close('route disposed')
          runtimes.delete(key)
        }
        remoteSocketRef.current?.close()
        remoteSocketRef.current = null
        remoteSocketBuilderRef.current = null
        pairingNotificationRef.current = false
        pairedAdmissionsRef.current.clear()
        approvalSessionRef.current = null
      }, 0)
      runtimeDisposalTimers.set(runtime, disposalTimer)
    }
  }, [key, remote, runtime, sessionToken, connectionRevision])

  const authenticateRemote = React.useCallback(
    async (input: {
      credentials: ProvisionalLogin
      factor?:
        | { kind: 'totp' | 'recovery'; code: string }
        | { kind: 'approval'; code?: string; codeKind?: 'totp' | 'recovery' }
    }) => {
      if (!remote) {
        if (input.factor?.kind === 'approval') throw new Error('Owner approval is remote-only.')
        return authenticateRemoteDevice({
          connection: runtime,
          credentials: input.credentials,
          factor: input.factor,
        })
      }
      const record = await loadDeviceKey()
      if (!record) throw new Error('Remote device key is missing')
      if (record.pairedClientToken && record.deviceId) {
        if (input.factor?.kind === 'approval')
          throw new Error(
            'This device is already paired; enter a verification code only if required.',
          )
        return authenticateRemoteDevice({
          connection: runtime,
          credentials: input.credentials,
          factor: input.factor,
        })
      }
      if (input.factor?.kind === 'approval') {
        if (runtime.state.transport !== 'connected')
          throw new Error('Owner connection is unavailable.')
        const provisional = await openProvisionalSession(runtime, input.credentials)
        const authentication =
          'sessionToken' in provisional
            ? provisional
            : input.factor.code && input.factor.codeKind
              ? await completeProvisionalTwoFactor(runtime, provisional.pendingTwoFactor, {
                  kind: input.factor.codeKind,
                  code: input.factor.code,
                })
              : null
        if (!authentication)
          throw new Error('Enter your authenticator or recovery code to complete sign-in.')
        const completed = [...pairedAdmissionsRef.current.values()].at(-1)
        if (completed?.status === 'fulfilled') return completed.session
        if (completed?.status === 'rejected') throw completed.error
        approvalSessionRef.current = authentication
        if (pairingWaitersRef.current.size > 0) {
          approvalSessionRef.current = null
          throw new Error('Another remote pairing is already in progress.')
        }
        return new Promise<{ ownerId: string; sessionToken: string }>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            if (waiter.settled) return
            waiter.settled = true
            pairingWaitersRef.current.delete(waiter)
            approvalSessionRef.current = null
            reject(new Error('Remote device approval expired. Start pairing again.'))
          }, PAIRING_TIMEOUT_MS)
          const waiter = {
            resolve: (session: { ownerId: string; sessionToken: string }) => {
              window.clearTimeout(timeout)
              resolve(session)
            },
            reject: (reason: Error) => {
              window.clearTimeout(timeout)
              reject(reason)
            },
            session: authentication,
            settled: false,
          }
          pairingWaitersRef.current.add(waiter)
        })
      }
      if (!input.factor) throw new Error('A verification code is required to pair this device.')
      const result = await promoteProvisionalDevice({
        connection: runtime,
        credentials: input.credentials,
        factor: input.factor,
        publicKey: record.publicKey,
        trustEpoch: remote.trustEpoch,
        nodeId: remote.nodeId,
        relayUrl: remote.relayUrl,
      })
      const paired = await loadDeviceKey()
      if (!paired?.pairedClientToken || !paired.deviceId)
        throw new Error('Paired device was not persisted')
      const pairedClientToken = paired.pairedClientToken
      const pairedDeviceId = paired.deviceId
      const pairedTrustEpoch = paired.trustEpoch ?? result.trustEpoch
      const pairedPublicKey = paired.publicKey
      const pairedPrivateKey = paired.privateKey
      const socketTarget = {
        nodeId: remote.nodeId,
        trustEpoch: pairedTrustEpoch,
        clientToken: pairedClientToken,
        deviceId: pairedDeviceId,
        publicKey: pairedPublicKey,
        privateKey: pairedPrivateKey,
      }
      remoteSocketRef.current?.close()
      remoteSocketRef.current = createRelayOwnerSocket(remote.relayUrl, socketTarget)
      remoteSocketBuilderRef.current = () => createRelayOwnerSocket(remote.relayUrl, socketTarget)
      await runtime.switchTarget({
        url: remote.relayUrl,
        clientId: 'owner-remote-app',
        capabilities: ['owner', 'remote-administration'],
        sessionToken: result.sessionToken,
      })
      await runtime.waitForConnection()
      if (runtime.state.authentication !== 'authenticated')
        throw new Error('Paired Owner admission was rejected.')
      return result
    },
    [remote, runtime],
  )

  return {
    status,
    error,
    isRemote: Boolean(remote) || key === 'remote-paired',
    request: runtime.request,
    openStream: runtime.openStream,
    close: runtime.close,
    authenticateRemoteDevice: authenticateRemote,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
