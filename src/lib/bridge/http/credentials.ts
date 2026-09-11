export type CredentialSummary = {
  id: string
  provider: string
  baseUrl: string
  createdAt?: string | Date
  updatedAt?: string | Date
}

export type CreateCredentialInput = { provider: string; baseUrl: string; apiKey: string }

export type CredentialsSnapshot = {
  items: readonly CredentialSummary[]
  currentCredentialId: string | null
}

type CredentialsResponse = { credentials?: unknown; currentCredentialId?: unknown }

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

function isCredentialSummary(value: unknown): value is CredentialSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.provider === 'string' &&
    typeof item.baseUrl === 'string'
  )
}

function toCredentialSummary(value: CredentialSummary): CredentialSummary {
  return {
    id: value.id,
    provider: value.provider,
    baseUrl: value.baseUrl,
    ...(typeof value.createdAt === 'string' || value.createdAt instanceof Date
      ? { createdAt: value.createdAt }
      : {}),
    ...(typeof value.updatedAt === 'string' || value.updatedAt instanceof Date
      ? { updatedAt: value.updatedAt }
      : {}),
  }
}

function errorMessage(status: number) {
  if (status === 401) return 'Your session has expired. Sign in again to view credentials.'
  if (status >= 500) return 'The server is temporarily unavailable.'
  return 'Could not load credentials. Try again.'
}

export async function fetchCredentials(signal?: AbortSignal): Promise<CredentialsSnapshot> {
  let response: Response
  try {
    response = await fetch('/api/credentials', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }

  if (!response.ok) {
    let code: string | null = null
    try {
      const body = (await response.json()) as { error?: { code?: unknown } }
      if (typeof body.error?.code === 'string') code = body.error.code
    } catch {
      // Keep transport failures user-safe when the bridge response is not JSON.
    }
    throw new ApiRequestError(errorMessage(response.status), response.status, code)
  }

  let body: CredentialsResponse
  try {
    body = (await response.json()) as CredentialsResponse
  } catch {
    throw new ApiRequestError(
      'The server returned an invalid credentials response.',
      response.status,
    )
  }

  if (
    !Array.isArray(body.credentials) ||
    !body.credentials.every(isCredentialSummary) ||
    (body.currentCredentialId !== null && typeof body.currentCredentialId !== 'string')
  ) {
    throw new ApiRequestError(
      'The server returned an invalid credentials response.',
      response.status,
    )
  }
  return {
    items: body.credentials.map(toCredentialSummary),
    currentCredentialId: body.currentCredentialId,
  }
}

export async function createCredential(input: CreateCredentialInput): Promise<CredentialSummary> {
  const response = await requestJson<unknown>('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isCredentialSummary(response))
    throw new ApiRequestError('The server returned an invalid credential response.', 200)
  return toCredentialSummary(response)
}

export async function deleteCredential(credentialId: string): Promise<void> {
  const response = await fetch(`/api/credentials/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw await responseError(response)
}

export async function selectCurrentCredential(credentialId: string): Promise<string> {
  const response = await requestJson<{ currentCredentialId?: unknown }>(
    '/api/credentials/current',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ credentialId }),
    },
  )
  if (typeof response.currentCredentialId !== 'string')
    throw new ApiRequestError('The server returned an invalid credential response.', 200)
  return response.currentCredentialId
}

export async function testCredential(credentialId: string): Promise<boolean> {
  await requestJson<{ ok: boolean }>(`/api/credentials/${encodeURIComponent(credentialId)}/test`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  return true
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'include' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Could not connect to the server. Try again.', 0)
  }
  if (!response.ok) throw await responseError(response)
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiRequestError('The server returned an invalid response.', response.status)
  }
}

async function responseError(response: Response) {
  let code: string | null = null
  let message = errorMessage(response.status)
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    if (typeof body.error?.code === 'string') code = body.error.code
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // Keep the safe status message when the bridge response is not JSON.
  }
  return new ApiRequestError(message, response.status, code)
}
