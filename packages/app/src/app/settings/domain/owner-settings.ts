import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
export type CredentialSummary = { id: string; provider: string; baseUrl: string; name?: string }
export type CredentialSnapshot = {
  items: readonly CredentialSummary[]
  currentCredentialId: string | null
}
export type ContextWindowConfig = { modelContextWindow: number }

export const ownerSettings = {
  credentials: {
    list: async (signal?: AbortSignal): Promise<CredentialSnapshot> => {
      const result = await getOwnerBridge().request<
        | CredentialSnapshot
        | { credentials: readonly CredentialSummary[]; currentCredentialId: string | null }
      >('credentials.list', undefined, { signal })
      if ('items' in result && Array.isArray(result.items)) return result
      if ('credentials' in result && Array.isArray(result.credentials))
        return { items: result.credentials, currentCredentialId: result.currentCredentialId }
      throw new Error('Credential list response is invalid.')
    },
    create: (input: { provider: string; baseUrl: string; apiKey: string }) =>
      getOwnerBridge().request<CredentialSummary>('credentials.create', input, { mutation: true }),
    test: (credentialId: string) =>
      getOwnerBridge().request('credentials.test', { credentialId }, { mutation: true }),
    select: async (credentialId: string) => {
      const result = await getOwnerBridge().request<unknown>(
        'credentials.select',
        { credentialId },
        { mutation: true },
      )
      return typeof result === 'string'
        ? result
        : ((result as { currentCredentialId?: string | null }).currentCredentialId ?? credentialId)
    },
    delete: (credentialId: string) =>
      getOwnerBridge().request('credentials.delete', { credentialId }, { mutation: true }),
  },
  configuration: {
    read: (signal?: AbortSignal) =>
      getOwnerBridge().request<ContextWindowConfig>('configuration.contextWindow.read', undefined, {
        signal,
      }),
    write: (modelContextWindow: number) =>
      getOwnerBridge().request(
        'configuration.contextWindow.write',
        { modelContextWindow },
        { mutation: true },
      ),
  },
}
