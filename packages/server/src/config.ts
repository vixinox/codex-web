import process from 'node:process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

export type ServerConfig = {
  host: string
  port: number
  appOrigin?: string
  rpId?: string
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
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
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
  const isProduction = process.env.NODE_ENV === 'production'
  const appOrigin = validateAppOrigin(
    process.env.CODEX_APP_ORIGIN?.trim() || (isProduction ? undefined : 'http://localhost:5173'),
    isProduction,
  )
  const rpId = validateRpId(process.env.CODEX_APP_RP_ID?.trim() || new URL(appOrigin).hostname)
  if (rpId !== new URL(appOrigin).hostname)
    throw new Error('CODEX_APP_RP_ID must match CODEX_APP_ORIGIN hostname')
  const trustedOrigins = [...new Set([appOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'])]

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
  const remoteRelayUrl = validateRelayUrl(process.env.CODEX_REMOTE_RELAY_URL?.trim() || undefined)
  const remoteRelayOwnerToken = process.env.CODEX_REMOTE_RELAY_OWNER_TOKEN?.trim() || undefined
  if (remoteRelayUrl && (!remoteRelayOwnerToken || remoteRelayOwnerToken.length < 32))
    throw new Error('CODEX_REMOTE_RELAY_OWNER_TOKEN must be configured with at least 32 characters')
  return {
    host,
    port: positiveInt(process.env.SERVER_PORT, 3000),
    appOrigin,
    rpId,
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
  }
}

function validateAppOrigin(value: string | undefined, production: boolean) {
  if (!value) throw new Error('CODEX_APP_ORIGIN must be configured in production')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('CODEX_APP_ORIGIN must be a valid origin')
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('CODEX_APP_ORIGIN must contain only a scheme, host, and optional port')
  if (production && parsed.protocol !== 'https:')
    throw new Error('CODEX_APP_ORIGIN must use HTTPS in production')
  if (
    !production &&
    parsed.protocol === 'http:' &&
    !['localhost', '127.0.0.1'].includes(parsed.hostname)
  )
    throw new Error('HTTP CODEX_APP_ORIGIN is limited to localhost in development')
  return parsed.origin
}

function validateRpId(value: string) {
  if (
    !value ||
    value.length > 253 ||
    value.includes('://') ||
    value.includes('/') ||
    value.includes(':')
  )
    throw new Error('CODEX_APP_RP_ID must be a hostname')
  if (!/^[A-Za-z0-9.-]+$/u.test(value) || value.startsWith('.') || value.endsWith('.'))
    throw new Error('CODEX_APP_RP_ID must be a hostname')
  return value.toLowerCase()
}

function validateRelayUrl(value: string | undefined) {
  if (!value) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('CODEX_REMOTE_RELAY_URL must be a valid WebSocket URL')
  }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('CODEX_REMOTE_RELAY_URL must use ws:// or wss:// without credentials')
  return parsed.toString()
}
