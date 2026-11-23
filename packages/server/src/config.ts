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
  credentialEncryptionKey: string
  remoteRelayUrl?: string
  remoteRelayOwnerToken?: string
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function credentialEncryptionKey(dataRoot: string): string {
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
  const configuredAppOrigin = process.env.CODEX_APP_ORIGIN?.trim() || undefined
  const appOrigin = configuredAppOrigin
    ? validateAppOrigin(configuredAppOrigin, isProduction)
    : undefined
  if (appOrigin && new URL(appOrigin).protocol !== 'https:' && isProduction)
    throw new Error('CODEX_APP_ORIGIN must use HTTPS in production')
  const remoteRelayUrl = validateRelayUrl(process.env.CODEX_REMOTE_RELAY_URL?.trim() || undefined)
  if (remoteRelayUrl && (!appOrigin || new URL(appOrigin).protocol !== 'https:'))
    throw new Error('CODEX_APP_ORIGIN must use HTTPS when remote Relay is configured')
  const rpId = appOrigin ? new URL(appOrigin).hostname : undefined
  const trustedOrigins = [
    ...new Set([
      ...(appOrigin ? [appOrigin] : []),
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]),
  ]

  const configuredDataRoot = process.env.CODEX_DATA_ROOT ?? './.data/codex'
  const dataRoot = isAbsolute(configuredDataRoot)
    ? configuredDataRoot
    : resolve(fileURLToPath(new URL('../../../', import.meta.url)), configuredDataRoot)
  const host = process.env.SERVER_HOST ?? '127.0.0.1'
  if (!['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new Error('SERVER_HOST must remain loopback')
  const remoteRelayOwnerToken = process.env.RELAY_OWNER_TOKEN?.trim() || undefined
  if (remoteRelayUrl && (!remoteRelayOwnerToken || remoteRelayOwnerToken.length < 32))
    throw new Error('RELAY_OWNER_TOKEN must be configured with at least 32 characters')
  return {
    host,
    port: positiveInt(process.env.SERVER_PORT, 3000),
    appOrigin,
    rpId,
    trustedOrigins,
    enforceOriginChecks: true,
    dataRoot,
    credentialEncryptionKey: credentialEncryptionKey(dataRoot),
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
