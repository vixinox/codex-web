export type GuestRuntimeStatus = 'starting' | 'ready' | 'failed' | 'stopped' | 'not-configured'

export type GuestRuntimeContract = {
  kind: 'guest-runtime'
  status: GuestRuntimeStatus
  maxActiveThreads: number
  modelContextWindow: number
  sandbox: 'workspaceWrite'
  network: 'disabled'
}
