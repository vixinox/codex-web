import { getOwnerBridge } from '../owner-runtime'

export type CredentialSummary = { id: string; provider: string; baseUrl: string; name?: string }
export type CredentialSnapshot = {
  items: readonly CredentialSummary[]
  currentCredentialId: string | null
}

export async function fetchCredentials(signal?: AbortSignal): Promise<CredentialSnapshot> {
  return (await getOwnerBridge().request('credentials.list', undefined, {
    signal,
  })) as CredentialSnapshot
}
export async function createCredential(input: {
  provider: string
  baseUrl: string
  apiKey: string
}) {
  return (await getOwnerBridge().request('credentials.create', input, {
    mutation: true,
  })) as CredentialSummary
}
export async function testCredential(id: string) {
  await getOwnerBridge().request('credentials.test', { credentialId: id }, { mutation: true })
  return true
}
export async function selectCurrentCredential(id: string) {
  const result = await getOwnerBridge().request(
    'credentials.select',
    { credentialId: id },
    { mutation: true },
  )
  return typeof result === 'string' ? result : id
}
export async function deleteCredential(id: string) {
  await getOwnerBridge().request('credentials.delete', { credentialId: id }, { mutation: true })
}
