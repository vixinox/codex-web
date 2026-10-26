import { getOwnerBridge } from '@/lib/bridge/owner-runtime'
export type CredentialSummary = { id: string; provider: string; baseUrl: string; name?: string }
export type CredentialSnapshot = {
  items: readonly CredentialSummary[]
  currentCredentialId: string | null
}
export type ContextWindowConfig = { modelContextWindow: number }

export const ownerSettings = {
  credentials: {
    list: (signal?: AbortSignal) =>
      getOwnerBridge().request<CredentialSnapshot>('credentials.list', undefined, { signal }),
    create: (input: { provider: string; baseUrl: string; apiKey: string }) =>
      getOwnerBridge().request<CredentialSummary>('credentials.create', input, { mutation: true }),
    test: (credentialId: string) =>
      getOwnerBridge().request('credentials.test', { credentialId }, { mutation: true }),
    select: (credentialId: string) =>
      getOwnerBridge().request<string>('credentials.select', { credentialId }, { mutation: true }),
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
