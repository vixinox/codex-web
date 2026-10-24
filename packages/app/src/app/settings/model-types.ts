export type SettingsCredential = { id: string; provider: string; baseUrl: string }
export type SettingsCollection<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: readonly T[] }
export type CredentialFormErrors = { provider?: string; baseUrl?: string; apiKey?: string }
