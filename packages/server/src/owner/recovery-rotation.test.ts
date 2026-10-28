import assert from 'node:assert/strict'
import DatabaseDriver from 'better-sqlite3'
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createAuth } from '../auth.js'
import type { ServerConfig } from '../config.js'
import { createDatabase } from '../database.js'
import { createWorkspaceService } from '../workspace.js'
import { createOwnerApplicationServices, withAuthSecret } from './application-services.js'

function config(dataRoot: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    authSecret: 'test-secret-that-is-at-least-32-characters',
    authUrl: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://localhost:5173'],
    dataRoot,
    maxActiveTasksPerUser: 2,
    credentialEncryptionKey: 'test-key',
    allowedOutboundSchemes: ['https'],
    allowedOutboundHosts: ['api.example.com'],
  }
}

async function seedOwner(dataRoot: string, settings: ServerConfig) {
  const bootstrap = new DatabaseDriver(path.join(dataRoot, 'owner.sqlite'))
  bootstrap.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, current_credential_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, two_factor_enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE session (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE);
    CREATE TABLE account (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE verification (id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE twoFactor (id TEXT PRIMARY KEY NOT NULL, secret TEXT NOT NULL, backup_codes TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, verified INTEGER NOT NULL DEFAULT 1, failed_verification_count INTEGER, locked_until INTEGER);
    CREATE TABLE project (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, name TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE credential (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, provider TEXT NOT NULL, base_url TEXT NOT NULL, encrypted_api_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE codex_event (id INTEGER PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, thread_id TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE owner_security_state (owner_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE, recovery_codes_acknowledged_at INTEGER);
  `)
  bootstrap.close()

  const database = createDatabase(settings)
  const auth = createAuth(settings, database.db)
  const signUp = await auth.api.signUpEmail({
    body: { email: 'owner@example.com', password: 'owner-password', name: 'Owner' },
  })
  const signIn = await auth.api.signInEmail({
    body: { email: 'owner@example.com', password: 'owner-password' },
    asResponse: true,
  })
  const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0]!
  const enabled = await auth.api.enableTwoFactor({
    body: { password: 'owner-password', method: 'totp' },
    headers: new Headers({ cookie }),
  })
  const totpURI = readString(enabled, 'totpURI')
  assert.ok(totpURI, 'enableTwoFactor must return a TOTP URI')
  const secret = new URL(totpURI).searchParams.get('secret')!
  await auth.api.verifyTOTP({
    body: { code: totp(secret) },
    headers: new Headers({ cookie }),
  })
  return { database, auth, ownerId: signUp.user.id }
}

function readString(value: unknown, key: string): string | null {
  if (value === null || typeof value !== 'object' || !(key in value)) return null
  const field = Reflect.get(value, key)
  return typeof field === 'string' ? field : null
}

function readStringArray(value: unknown, key: string): string[] | null {
  if (value === null || typeof value !== 'object' || !(key in value)) return null
  const field: unknown = Reflect.get(value, key)
  if (!Array.isArray(field) || !field.every((entry) => typeof entry === 'string')) return null
  return field
}

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const character of secret.replace(/=+$/u, '').toUpperCase())
    bits += alphabet.indexOf(character).toString(2).padStart(5, '0')
  const key: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8)
    key.push(Number.parseInt(bits.slice(index, index + 8), 2))
  const counter = Buffer.alloc(8)
  const step = Math.floor(Date.now() / 30_000)
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0)
  counter.writeUInt32BE(step >>> 0, 4)
  const digest = createHmac('sha1', Buffer.from(key)).update(counter).digest()
  const offset = digest[digest.length - 1]! & 0xf
  return (((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000) + '').padStart(6, '0')
}

test('local recovery rotation replaces the group without the Owner password', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-web-recovery-'))
  const settings = config(dataRoot)
  const { database, auth, ownerId } = await seedOwner(dataRoot, settings)
  try {
    const workspace = createWorkspaceService(settings, database.db)
    const services = createOwnerApplicationServices(
      withAuthSecret({ auth, workspace, codex: {} as never }, settings),
      { trustedOrigins: settings.trustedOrigins },
    )
    const before = readStringArray(
      await auth.api.viewBackupCodes({ body: { userId: ownerId } }),
      'backupCodes',
    )
    assert.ok(before)

    const rotated = await services.localManagement.rotateRecoveryCodes()
    const codes = readStringArray(rotated, 'recoveryCodes')
    assert.ok(codes)
    assert.equal(codes.length, 10)
    assert.ok(codes.every((code) => !before.includes(code)))
    const context = await auth.$context
    const session = await context.internalAdapter.createSession(ownerId)
    const headers = new Headers({ authorization: `Bearer ${session.token}` })
    const verified = await auth.api.verifyBackupCode({
      body: { code: codes[0]! },
      headers,
    })
    assert.ok(verified.user)

    const rejected = await auth.api
      .verifyBackupCode({ body: { code: before[0]! }, headers })
      .then(() => null)
      .catch((error: Error) => error)
    assert.ok(rejected, 'a code from the replaced group must stop working')
  } finally {
    database.driver.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
