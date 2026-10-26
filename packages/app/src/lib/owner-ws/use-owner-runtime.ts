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
  loadDeviceKey,
  setPairedDevice,
  setRemoteTarget,
} from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'
import {
  authenticateRemoteDevice,
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
    factor?: { kind: 'totp' | 'recovery'; code: string } | { kind: 'approval' }
  }): Promise<
    { ownerId: string; sessionToken: string } | (PairedAdmission & { sessionToken: string })
  >
}

const runtimes = new Map<string, SessionController>()

export function useOwnerRuntime(sessionToken: string | undefined): OwnerRuntimeController {
  const remote = getRemoteBootstrap()
  const key = remote
    ? `remote:${remote.bootstrapId}`
    : sessionToken
      ? `local:${sessionToken}`
      : 'remote-paired'
  const remoteSocketRef = React.useRef<WebSocket | null>(null)
  const remoteSocketBuilderRef = React.useRef<(() => WebSocket) | null>(null)
  const pairingCompletedRef = React.useRef<Promise<void> | null>(null)
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
    let active = true
    let resolvePairing: (() => void) | null = null
    const pairingCompleted = new Promise<void>((resolve) => {
      resolvePairing = resolve
    })
    pairingCompletedRef.current = pairingCompleted
    const unsubscribe = runtime.subscribe(() => {
      if (!active) return
      setSnapshot({ ...runtime.state })
      if (runtime.state.transport === 'connected') setOwnerBridge(runtime.runtime)
    })
    const unsubscribeNotification = runtime.runtime.subscribeNotification((method, params) => {
      if (!active || method !== 'remote.device.paired' || !remote || !isRecord(params)) return
      const deviceId = params.deviceId
      const clientToken = params.clientToken
      if (typeof deviceId !== 'string' || typeof clientToken !== 'string') return
      void (async () => {
        const record = await loadDeviceKey()
        if (!active || !record) return
        await setPairedDevice({
          deviceId,
          pairedClientToken: clientToken,
          trustEpoch: remote.trustEpoch,
          nodeId: remote.nodeId,
          relayUrl: remote.relayUrl,
        })
        const paired = await loadDeviceKey()
        if (!active || !paired?.pairedClientToken || !paired.deviceId) return
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
        await runtime.switchTarget({
          url: remote.relayUrl,
          clientId: 'owner-remote-app',
          capabilities: ['owner', 'remote-administration'],
        })
        resolvePairing?.()
      })().catch(() => undefined)
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
    }
    void connect()
      .then(() => {
        if (!active) return
        setOwnerBridge(runtime.runtime)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setSnapshot({
          ...runtime.state,
          error: cause instanceof Error ? cause.message : 'Owner connection failed',
        })
      })
    return () => {
      active = false
      unsubscribe()
      unsubscribeNotification()
      if (runtimes.get(key) === runtime) {
        runtime.close('route disposed')
        runtimes.delete(key)
      }
      remoteSocketRef.current?.close()
      remoteSocketRef.current = null
      remoteSocketBuilderRef.current = null
      pairingCompletedRef.current = null
      setOwnerBridge(null)
    }
  }, [key, remote, runtime, sessionToken])

  const authenticateRemote = React.useCallback(
    async (input: {
      credentials: ProvisionalLogin
      factor?: { kind: 'totp' | 'recovery'; code: string } | { kind: 'approval' }
    }) => {
      if (!remote) {
        if (input.factor?.kind === 'approval') throw new Error('Owner approval is remote-only.')
        return authenticateRemoteDevice({
          connection: runtime.runtime,
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
          connection: runtime.runtime,
          credentials: input.credentials,
          factor: input.factor,
        })
      }
      if (input.factor?.kind === 'approval') {
        await openProvisionalSession(runtime.runtime, input.credentials)
        if (!pairingCompletedRef.current) throw new Error('Remote pairing is unavailable.')
        await pairingCompletedRef.current
        return authenticateRemoteDevice({
          connection: runtime.runtime,
          credentials: input.credentials,
        })
      }
      if (!input.factor) throw new Error('A verification code is required to pair this device.')
      const result = await promoteProvisionalDevice({
        connection: runtime.runtime,
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
