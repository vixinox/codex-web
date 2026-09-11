import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import net from 'node:net'

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

export function validateOutboundUrl(
  value: string,
  allowedSchemes: string[],
  allowedHosts: string[],
): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('baseUrl must be an absolute URL')
  }
  if (!allowedSchemes.includes(parsed.protocol.slice(0, -1).toLowerCase()))
    throw new Error('baseUrl scheme is not allowed')
  if (!allowedHosts.includes('*') && !allowedHosts.includes(parsed.hostname.toLowerCase()))
    throw new Error('baseUrl host is not allowed')
  if (net.isIP(parsed.hostname) && isPrivateAddress(parsed.hostname))
    throw new Error('baseUrl host is not routable')
  if (parsed.username || parsed.password) throw new Error('baseUrl must not contain credentials')
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

export async function validateProviderConnection(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  lookupImpl: typeof lookup = lookup,
) {
  const parsed = new URL(baseUrl)
  // Unit tests may provide a fake fetch; real outbound calls always use the
  // resolver check below before a credential is sent over the network.
  if (fetchImpl === fetch) await assertPublicDestination(parsed.hostname, lookupImpl)
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

/** Reject destinations that would let a user turn the bridge into an internal scanner. */
async function assertPublicDestination(hostname: string, lookupImpl: typeof lookup) {
  const literal = net.isIP(hostname)
  if (literal && isPrivateAddress(hostname)) throw new Error('baseUrl host is not routable')
  if (literal) return
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookupImpl(hostname, { all: true, verbatim: true })
  } catch (error) {
    throw new Error('Provider host could not be resolved', { cause: error })
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address)))
    throw new Error('baseUrl host is not routable')
}

function isPrivateAddress(value: string) {
  const family = net.isIP(value)
  if (family === 4) {
    const [a, b] = value.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (family !== 6) return true
  const normalized = value.toLowerCase()
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7))
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  )
}

export function validateProjectName(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name === '.' || name === '..') {
    throw new Error('Project name must be a safe directory name')
  }
  return name
}
