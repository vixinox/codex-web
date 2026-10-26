import * as React from 'react'
import { createOwnerRuntime, type OwnerRuntime } from './owner-runtime'
import { setOwnerBridge } from '@/lib/bridge/owner-runtime'
import { getRemoteBootstrap } from '@/app/entry/bootstrap'
import { createDeviceKey, loadDeviceKey } from '@/lib/remote/device-key-store'
import { createRelayOwnerSocket } from '@/lib/remote/relay-owner-socket'

export type OwnerRuntimeController = {
  runtime: OwnerRuntime
  status: 'idle' | 'connecting' | 'ready' | 'remote-unavailable' | 'failed'
  error: string | null
}

const runtimes = new Map<string, OwnerRuntime>()

export function useOwnerRuntime(sessionToken: string | undefined): OwnerRuntimeController {
  const remote = getRemoteBootstrap()
  const key = remote ? `remote:${remote.bootstrapId}` : `local:${sessionToken ?? 'anonymous'}`
  const remoteSocketRef = React.useRef<WebSocket | null>(null)
  const runtime = React.useMemo(() => {
    const existing = runtimes.get(key)
    if (existing) return existing
    const created = createOwnerRuntime((url) => remoteSocketRef.current ?? new WebSocket(url))
    runtimes.set(key, created)
    return created
  }, [key])
  const [status, setStatus] = React.useState<OwnerRuntimeController['status']>(
    remote ? 'remote-unavailable' : 'idle',
  )
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!sessionToken && !remote) return
    let active = true
    setStatus('connecting')
    setError(null)
    const unsubscribe = runtime.subscribe(() => {
      if (!active) return
      if (runtime.state === 'connected') {
        setStatus('ready')
        setOwnerBridge(runtime)
      } else if (runtime.state === 'failed') setStatus('failed')
    })
    const connect = async () => {
      if (!remote) {
        await runtime.connect({
          url: `${window.location.origin.replace(/^http/, 'ws')}/ws`,
          sessionToken,
          clientId: 'owner-app',
          capabilities: ['owner', 'remote-administration'],
        })
        return
      }
      let record = await loadDeviceKey()
      if (!record) {
        await createDeviceKey()
        record = await loadDeviceKey()
      }
      if (!record) throw new Error('Unable to create a remote device key')
      const token = record.pairedClientToken ?? remote.clientToken
      remoteSocketRef.current = createRelayOwnerSocket(remote.relayUrl, {
        nodeId: remote.nodeId,
        trustEpoch: record.trustEpoch ?? remote.trustEpoch,
        clientToken: token,
        ...(record.pairedClientToken && record.deviceId
          ? { deviceId: record.deviceId }
          : { bootstrapId: remote.bootstrapId }),
        publicKey: record.publicKey,
        privateKey: record.privateKey,
      })
      await runtime.connect({
        url: remote.relayUrl,
        clientId: 'owner-remote-app',
        capabilities: ['owner', 'remote-administration'],
      })
    }
    void connect()
      .then(() => {
        if (!active) return
        setStatus('ready')
        setOwnerBridge(runtime)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setStatus('failed')
        setError(cause instanceof Error ? cause.message : 'Owner connection failed')
      })
    return () => {
      active = false
      unsubscribe()
      if (runtimes.get(key) === runtime) {
        runtime.close('route disposed')
        runtimes.delete(key)
      }
      remoteSocketRef.current?.close()
      remoteSocketRef.current = null
      setOwnerBridge(null)
    }
  }, [key, remote, runtime, sessionToken])

  return { runtime, status, error }
}
