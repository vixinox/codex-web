import process from 'node:process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export type ServerConfig = {
  mode: 'owner' | 'guest'
  host: string
  port: number
  databaseUrl: string
  databaseSsl: boolean
  authSecret: string
  authUrl: string
  trustedOrigins: string[]
  /** Optional managed Codex App Server version lock. */
  codexRuntimeVersion: string | null
  dataRoot: string
  maxActiveTasksPerUser: number
  credentialEncryptionKey: string
  allowedOutboundSchemes: string[]
  allowedOutboundHosts: string[]
  requireDangerousAccessConfirmation?: boolean
  guest?: GuestConfig
}

export type GuestConfig = {
  provider: string
  baseUrl: string
  apiKey: string
  skillRoots: string[]
  leaseTtlHours: number
  globalDailyTokenLimit: number
  perGuestDailyTokenLimit: number
  maxActiveThreads: number
  maxQueue: number
  maxTokensPerTurn: number
  modelContextWindow: number
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function positiveSafeInt(name: string, value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function fixedGuestLeaseTtl(value: string | undefined) {
  if (value === undefined || value.trim() === '') return 24
  if (Number(value) !== 24) throw new Error('GUEST_LEASE_TTL_HOURS must be 24')
  return 24
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
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

export function loadServerConfig(mode: ServerConfig['mode']): ServerConfig {
  const authSecret = process.env.BETTER_AUTH_SECRET?.trim() || ''
  if (authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters')

  const authUrl = url('BETTER_AUTH_URL', process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000')
  const trustedOrigins = (
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
  )
    .split(',')
    .map((origin) => url('BETTER_AUTH_TRUSTED_ORIGINS', origin.trim()))

  const dataRoot = process.env.CODEX_DATA_ROOT ?? './.data/codex'
  const host = process.env.SERVER_HOST ?? '127.0.0.1'
  if (process.env.NODE_ENV === 'production' && !['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new Error('SERVER_HOST must remain loopback in single-user mode')
  const allowedOutboundHosts = (process.env.CODEX_ALLOWED_OUTBOUND_HOSTS ?? 'api.openai.com')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  if (process.env.NODE_ENV === 'production' && allowedOutboundHosts.includes('*'))
    throw new Error('CODEX_ALLOWED_OUTBOUND_HOSTS must be explicit in production')
  const guestProvider = process.env.GUEST_CODEX_PROVIDER?.trim()
  const guestBaseUrl = process.env.GUEST_CODEX_BASE_URL?.trim()
  const guestApiKey = process.env.GUEST_CODEX_API_KEY?.trim()
  if (
    [guestProvider, guestBaseUrl, guestApiKey].some(Boolean) &&
    ![guestProvider, guestBaseUrl, guestApiKey].every(Boolean)
  )
    throw new Error(
      'GUEST_CODEX_PROVIDER, GUEST_CODEX_BASE_URL, and GUEST_CODEX_API_KEY must be configured together',
    )
  const guest =
    guestProvider && guestBaseUrl && guestApiKey
      ? {
          provider: guestProvider,
          baseUrl: url('GUEST_CODEX_BASE_URL', guestBaseUrl),
          apiKey: guestApiKey,
          skillRoots: (process.env.GUEST_CODEX_SKILL_ROOTS ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
          leaseTtlHours: fixedGuestLeaseTtl(process.env.GUEST_LEASE_TTL_HOURS),
          globalDailyTokenLimit: positiveInt(process.env.GUEST_GLOBAL_DAILY_TOKEN_LIMIT, 1_000_000),
          perGuestDailyTokenLimit: positiveInt(
            process.env.GUEST_PER_GUEST_DAILY_TOKEN_LIMIT,
            128_000,
          ),
          maxActiveThreads: positiveInt(process.env.GUEST_MAX_ACTIVE_THREADS, 5),
          maxQueue: positiveInt(process.env.GUEST_MAX_QUEUE, 20),
          maxTokensPerTurn: positiveInt(process.env.GUEST_MAX_TOKENS_PER_TURN, 16_000),
          modelContextWindow: positiveSafeInt(
            'GUEST_MODEL_CONTEXT_WINDOW',
            process.env.GUEST_MODEL_CONTEXT_WINDOW,
            256_000,
          ),
        }
      : undefined
  return {
    mode,
    host,
    port: positiveInt(process.env.SERVER_PORT, 3000),
    databaseUrl: required('DATABASE_URL', process.env.DATABASE_URL),
    databaseSsl: process.env.DATABASE_SSL === 'true',
    authSecret,
    authUrl,
    trustedOrigins,
    codexRuntimeVersion: process.env.CODEX_RUNTIME_VERSION?.trim() || null,
    dataRoot,
    maxActiveTasksPerUser: positiveInt(process.env.CODEX_MAX_ACTIVE_TASKS_PER_USER, 2),
    credentialEncryptionKey: mode === 'guest' ? '' : credentialEncryptionKey(dataRoot),
    allowedOutboundSchemes: (process.env.CODEX_ALLOWED_OUTBOUND_SCHEMES ?? 'https')
      .split(',')
      .map((scheme) => scheme.trim().toLowerCase())
      .filter(Boolean),
    allowedOutboundHosts,
    requireDangerousAccessConfirmation:
      process.env.NODE_ENV === 'production' ||
      process.env.CODEX_REQUIRE_DANGEROUS_ACCESS_CONFIRMATION === 'true',
    guest,
  }
}
