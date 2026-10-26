import process from 'node:process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

export type ServerConfig = {
  host: string
  port: number
  authSecret: string
  authUrl: string
  trustedOrigins: string[]
  enforceOriginChecks?: boolean
  dataRoot: string
  maxActiveTasksPerUser: number
  credentialEncryptionKey: string
  allowedOutboundSchemes: string[]
  allowedOutboundHosts: string[]
  requireDangerousAccessConfirmation?: boolean
  remoteRelayUrl?: string
  remoteRelayOwnerToken?: string
  remoteAppUrl?: string
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function url(name: string, value: string): string {
  try {
    return new URL(value).origin
  } catch {
    throw new Error(`${name} must be an absolute URL`)
  }
}

function credentialEncryptionKey(dataRoot: string): string {
  const configured = process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CODEX_CREDENTIAL_ENCRYPTION_KEY is required in production')
  }

  mkdirSync(dataRoot, { recursive: true })
  const keyPath = join(dataRoot, '.credential-encryption-key')
  if (existsSync(keyPath)) {
    const persisted = readFileSync(keyPath, 'utf8').trim()
    if (persisted) return persisted
  }

  const generated = randomBytes(32).toString('base64url')
  writeFileSync(keyPath, `${generated}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(keyPath, 0o600)
  } catch {
    /* Windows has no POSIX mode bits. */
  }
  return generated
}

export function loadServerConfig(): ServerConfig {
  const authSecret = process.env.BETTER_AUTH_SECRET?.trim() || ''
  if (authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters')

  const authUrl = url('BETTER_AUTH_URL', process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000')
  const trustedOrigins = (
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((origin) => url('BETTER_AUTH_TRUSTED_ORIGINS', origin.trim()))

  const configuredDataRoot = process.env.CODEX_DATA_ROOT ?? './.data/codex'
  const dataRoot = isAbsolute(configuredDataRoot)
    ? configuredDataRoot
    : resolve(fileURLToPath(new URL('../../../', import.meta.url)), configuredDataRoot)
  const host = process.env.SERVER_HOST ?? '127.0.0.1'
  if (!['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new Error('SERVER_HOST must remain loopback')
  const allowedOutboundHosts = (process.env.CODEX_ALLOWED_OUTBOUND_HOSTS ?? 'api.openai.com')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (process.env.NODE_ENV === 'production' && allowedOutboundHosts.includes('*'))
    throw new Error('CODEX_ALLOWED_OUTBOUND_HOSTS must be explicit in production')
  const remoteRelayUrl = process.env.CODEX_REMOTE_RELAY_URL?.trim() || undefined
  const remoteRelayOwnerToken = process.env.CODEX_REMOTE_RELAY_OWNER_TOKEN?.trim() || undefined
  if (remoteRelayUrl && (!remoteRelayOwnerToken || remoteRelayOwnerToken.length < 32))
    throw new Error('CODEX_REMOTE_RELAY_OWNER_TOKEN must be configured with at least 32 characters')
  const remoteAppUrl = process.env.CODEX_REMOTE_APP_URL?.trim() || undefined
  return {
    host,
    port: positiveInt(process.env.SERVER_PORT, 3000),
    authSecret,
    authUrl,
    trustedOrigins,
    enforceOriginChecks: true,
    dataRoot,
    maxActiveTasksPerUser: positiveInt(process.env.CODEX_MAX_ACTIVE_TASKS_PER_USER, 2),
    credentialEncryptionKey: credentialEncryptionKey(dataRoot),
    allowedOutboundSchemes: (process.env.CODEX_ALLOWED_OUTBOUND_SCHEMES ?? 'https')
      .split(',')
      .map((scheme) => scheme.trim().toLowerCase())
      .filter(Boolean),
    allowedOutboundHosts,
    requireDangerousAccessConfirmation:
      process.env.NODE_ENV === 'production' ||
      process.env.CODEX_REQUIRE_DANGEROUS_ACCESS_CONFIRMATION === 'true',
    remoteRelayUrl,
    remoteRelayOwnerToken,
    remoteAppUrl,
  }
}
