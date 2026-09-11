export type CodexStatus = {
  status: 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'
  projectId: string | null
  activeCredentialId: string | null
  currentCredentialId: string | null
  pendingCredentialId: string | null
  restartRequired: boolean
  activeTurns: number
  error: string | null
}

export async function fetchCodexStatus(signal?: AbortSignal): Promise<CodexStatus> {
  return requestJson<CodexStatus>('/api/codex/status', { method: 'GET', signal })
}

export async function startCodex(
  credentialId?: string,
  confirmDangerousAccess = false,
): Promise<CodexStatus> {
  return requestJson<CodexStatus>('/api/codex/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...(credentialId ? { credentialId } : {}),
      confirmDangerousAccess,
    }),
  })
}

export async function restartCodex(
  credentialId?: string,
  confirmDangerousAccess = false,
): Promise<CodexStatus> {
  return requestJson<CodexStatus>('/api/codex/restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...(credentialId ? { credentialId } : {}),
      confirmDangerousAccess,
    }),
  })
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'include' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Could not connect to the server. Try again.', { cause: error })
  }
  if (!response.ok) {
    let message =
      response.status >= 500 ? 'Codex is unavailable. Try again.' : 'Codex request failed.'
    let code: string | null = null
    try {
      const body = (await response.json()) as { error?: { message?: unknown } }
      if (typeof body.error?.message === 'string') message = body.error.message
      if (typeof (body.error as { code?: unknown } | undefined)?.code === 'string')
        code = (body.error as { code: string }).code
    } catch {
      // Keep the safe fallback message.
    }
    const error = new Error(message) as Error & { code?: string; status?: number }
    error.code = code ?? undefined
    error.status = response.status
    throw error
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new Error('The server returned an invalid Codex status.')
  }
}
