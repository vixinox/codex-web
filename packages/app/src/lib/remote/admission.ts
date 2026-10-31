export type AdmissionConnection = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>
  close(reason?: string): void
}

export async function authenticateWithPasskey(
  connection: AdmissionConnection,
  originProfile: 'local' | 'remote',
) {
  const options = await connection.request<{
    challengeId: string
    options: PublicKeyCredentialRequestOptionsJSON
  }>('owner.passkey.authentication.options')
  const credential = await navigator.credentials.get({
    publicKey: browserRequestOptions(options.options),
  })
  if (!(credential instanceof PublicKeyCredential))
    throw new Error('Passkey authentication was cancelled.')
  const response = credentialToJson(credential)
  const result = await connection.request<{ token: string; expiresAt: string; ownerId?: string }>(
    'owner.passkey.authentication.verify',
    { challengeId: options.challengeId, response },
  )
  if (
    typeof result.token !== 'string' ||
    !result.token ||
    typeof result.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    (result.ownerId !== undefined && typeof result.ownerId !== 'string')
  )
    throw new Error('Passkey authentication returned an invalid session.')
  return { ...result, originProfile }
}

function browserRequestOptions(
  options: PublicKeyCredentialRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: fromBase64Url(options.challenge),
    allowCredentials: options.allowCredentials?.map((item) => ({
      type: 'public-key' as const,
      id: fromBase64Url(item.id),
      transports: item.transports?.filter(isAuthenticatorTransport),
    })),
  } as unknown as PublicKeyCredentialRequestOptions
}

function isAuthenticatorTransport(value: string): value is AuthenticatorTransport {
  return ['ble', 'hybrid', 'internal', 'nfc', 'usb'].includes(value)
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function credentialToJson(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: toBase64Url(new Uint8Array(credential.rawId)),
    type: credential.type,
    response: {
      authenticatorData: toBase64Url(new Uint8Array(response.authenticatorData)),
      clientDataJSON: toBase64Url(new Uint8Array(response.clientDataJSON)),
      signature: toBase64Url(new Uint8Array(response.signature)),
      userHandle: response.userHandle ? toBase64Url(new Uint8Array(response.userHandle)) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}
