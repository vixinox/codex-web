import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadServerConfig } from './config.js'

test('rejects non-loopback server hosts', () => {
  const names = ['SERVER_HOST', 'CODEX_APP_ORIGIN', 'CODEX_REMOTE_RELAY_URL', 'RELAY_OWNER_TOKEN']
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  process.env.SERVER_HOST = '0.0.0.0'
  try {
    assert.throws(() => loadServerConfig(), /SERVER_HOST must remain loopback/)
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('requires a relay admission token when remote relay is configured', () => {
  const names = ['SERVER_HOST', 'CODEX_APP_ORIGIN', 'CODEX_REMOTE_RELAY_URL', 'RELAY_OWNER_TOKEN']
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  process.env.SERVER_HOST = '127.0.0.1'
  process.env.CODEX_APP_ORIGIN = 'https://app.example.test'
  process.env.CODEX_REMOTE_RELAY_URL = 'wss://relay.example.test/ws'
  delete process.env.RELAY_OWNER_TOKEN
  try {
    assert.throws(() => loadServerConfig(), /RELAY_OWNER_TOKEN/)
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('validates the configured remote App origin and derives its WebAuthn RP ID', () => {
  const names = [
    'NODE_ENV',
    'CODEX_DATA_ROOT',
    'CODEX_APP_ORIGIN',
    'CODEX_REMOTE_RELAY_URL',
    'RELAY_OWNER_TOKEN',
  ]
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  const dataRoot = mkdtempSync(join(tmpdir(), 'codex-web-config-'))
  process.env.CODEX_DATA_ROOT = dataRoot
  process.env.NODE_ENV = 'production'
  process.env.CODEX_APP_ORIGIN = 'https://app.example.test'
  process.env.CODEX_REMOTE_RELAY_URL = 'wss://relay.example.test/ws'
  process.env.RELAY_OWNER_TOKEN = 'x'.repeat(32)
  try {
    const config = loadServerConfig()
    assert.equal(
      config.credentialEncryptionKey,
      readFileSync(join(dataRoot, '.credential-encryption-key'), 'utf8').trim(),
    )
    assert.equal(loadServerConfig().credentialEncryptionKey, config.credentialEncryptionKey)
    assert.equal(config.appOrigin, 'https://app.example.test')
    assert.equal(config.rpId, 'app.example.test')
    assert.equal(config.remoteRelayUrl, 'wss://relay.example.test/ws')
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('supports local-only production without a remote App origin or Passkey profile', () => {
  const names = [
    'NODE_ENV',
    'CODEX_DATA_ROOT',
    'CODEX_APP_ORIGIN',
    'CODEX_REMOTE_RELAY_URL',
    'RELAY_OWNER_TOKEN',
  ]
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  const dataRoot = mkdtempSync(join(tmpdir(), 'codex-web-config-'))
  process.env.CODEX_DATA_ROOT = dataRoot
  process.env.NODE_ENV = 'production'
  delete process.env.CODEX_APP_ORIGIN
  delete process.env.CODEX_REMOTE_RELAY_URL
  delete process.env.RELAY_OWNER_TOKEN
  try {
    const config = loadServerConfig()
    assert.equal(
      config.credentialEncryptionKey,
      readFileSync(join(dataRoot, '.credential-encryption-key'), 'utf8').trim(),
    )
    assert.equal(loadServerConfig().credentialEncryptionKey, config.credentialEncryptionKey)
    assert.equal(config.appOrigin, undefined)
    assert.equal(config.rpId, undefined)
    assert.deepEqual(config.trustedOrigins, ['http://localhost:5173', 'http://127.0.0.1:5173'])
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
