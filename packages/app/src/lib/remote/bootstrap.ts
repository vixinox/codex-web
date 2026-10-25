export type RemoteBootstrap = {
  bootstrapId: string
  nodeId: string
  trustEpoch: number
  relayUrl: string
  clientToken: string
}

const required = ['bootstrapId', 'nodeId', 'relayUrl', 'clientToken'] as const

export function consumeRemoteBootstrap(url: string): {
  value: RemoteBootstrap | null
  cleanUrl: string
} {
  const parsed = new URL(url)
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  parsed.hash = ''
  if (!fragment) return { value: null, cleanUrl: parsed.toString() }
  const params = new URLSearchParams(fragment)
  if (params.get('kind') !== 'codex-remote-bootstrap')
    return { value: null, cleanUrl: parsed.toString() }
  if (required.some((key) => !params.get(key))) return { value: null, cleanUrl: parsed.toString() }
  const trustEpoch = Number(params.get('trustEpoch'))
  if (!Number.isSafeInteger(trustEpoch) || trustEpoch < 0)
    return { value: null, cleanUrl: parsed.toString() }
  return {
    value: {
      bootstrapId: params.get('bootstrapId')!,
      nodeId: params.get('nodeId')!,
      trustEpoch,
      relayUrl: params.get('relayUrl')!,
      clientToken: params.get('clientToken')!,
    },
    cleanUrl: parsed.toString(),
  }
}

export function clearRemoteBootstrapAddress(history: Pick<History, 'replaceState'>, url: string) {
  const { cleanUrl } = consumeRemoteBootstrap(url)
  history.replaceState(null, '', cleanUrl)
  return cleanUrl
}
