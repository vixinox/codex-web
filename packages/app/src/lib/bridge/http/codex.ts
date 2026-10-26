import { getOwnerBridge } from '../owner-runtime'

export type CodexStatus = {
  status: 'ready' | 'starting' | 'restarting' | 'stopped' | 'failed'
  currentCredentialId: string | null
  activeCredentialId: string | null
  error?: string
}

export async function fetchCodexStatus(signal?: AbortSignal): Promise<CodexStatus> {
  return (await getOwnerBridge().request('codex.status', undefined, { signal })) as CodexStatus
}
export async function startCodex(credentialId?: string, wait = false) {
  return (await getOwnerBridge().request(
    'codex.start',
    { credentialId, wait },
    { mutation: true },
  )) as CodexStatus
}
export async function restartCodex(credentialId: string, wait = false) {
  return (await getOwnerBridge().request(
    'codex.restart',
    { credentialId, wait },
    { mutation: true },
  )) as CodexStatus
}
