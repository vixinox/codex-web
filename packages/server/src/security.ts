import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export function encryptSecret(secret: string, keyMaterial: string): string {
  const key = createHash('sha256').update(keyMaterial).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`
}

export function decryptSecret(payload: string, keyMaterial: string): string {
  const [version, ivText, tagText, ciphertextText] = payload.split(':')
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText)
    throw new Error('Unsupported encrypted secret')
  const key = createHash('sha256').update(keyMaterial).digest()
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function validateOutboundUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('baseUrl must be an absolute URL')
  }
  if (parsed.username || parsed.password) throw new Error('baseUrl must not contain credentials')
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export async function validateProviderConnection(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('Provider rejected the credential')
  } catch (error) {
    if (error instanceof Error && error.message === 'Provider rejected the credential') throw error
    throw new Error('Provider connection validation failed', { cause: error })
  } finally {
    clearTimeout(timeout)
  }
}

export function validateProjectName(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name === '.' || name === '..') {
    throw new Error('Project name must be a safe directory name')
  }
  return name
}
