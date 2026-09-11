const DEFAULT_MODEL_CONTEXT_WINDOW = 256_000

export type ContextWindowConfig = {
  modelContextWindow: number
  source: 'configured' | 'default'
}

export async function fetchContextWindow(signal?: AbortSignal): Promise<ContextWindowConfig> {
  return requestJson<ContextWindowConfig>('/api/configuration/context-window', {
    method: 'GET',
    signal,
  })
}

export async function updateContextWindow(
  modelContextWindow: number,
): Promise<ContextWindowConfig> {
  return requestJson<ContextWindowConfig>('/api/configuration/context-window', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ modelContextWindow }),
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
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('The server returned an invalid configuration response.')
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
        ? (body as { error: { message: string } }).error.message
        : 'Could not update Codex configuration. Try again.'
    const error = new Error(message) as Error & { code?: string; status?: number }
    error.status = response.status
    if (typeof (body as { error?: { code?: unknown } }).error?.code === 'string')
      error.code = (body as { error: { code: string } }).error.code
    throw error
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !Number.isSafeInteger((body as { modelContextWindow?: unknown }).modelContextWindow) ||
    !(
      (body as { source?: unknown }).source === 'configured' ||
      (body as { source?: unknown }).source === 'default'
    )
  )
    throw new Error('The server returned an invalid configuration response.')
  return body as T
}

export { DEFAULT_MODEL_CONTEXT_WINDOW }
