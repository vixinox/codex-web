import assert from 'node:assert/strict'
import test from 'node:test'

import { loadServerConfig } from './config.js'

test('rejects non-loopback server hosts', () => {
  const names = [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'SERVER_HOST',
    'CODEX_CREDENTIAL_ENCRYPTION_KEY',
    'CODEX_REMOTE_RELAY_URL',
    'CODEX_REMOTE_RELAY_OWNER_TOKEN',
  ]
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  process.env.BETTER_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters'
  process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000'
  process.env.SERVER_HOST = '0.0.0.0'
  process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY = 'test-key'
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
  const names = [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'SERVER_HOST',
    'CODEX_CREDENTIAL_ENCRYPTION_KEY',
    'CODEX_REMOTE_RELAY_URL',
    'CODEX_REMOTE_RELAY_OWNER_TOKEN',
  ]
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  process.env.BETTER_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters'
  process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000'
  process.env.SERVER_HOST = '127.0.0.1'
  process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY = 'test-key'
  process.env.CODEX_REMOTE_RELAY_URL = 'wss://relay.example.test/ws'
  delete process.env.CODEX_REMOTE_RELAY_OWNER_TOKEN
  try {
    assert.throws(() => loadServerConfig(), /CODEX_REMOTE_RELAY_OWNER_TOKEN/)
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('validates the configured app origin and WebAuthn RP id profile', () => {
  const names = [
    'NODE_ENV',
    'CODEX_APP_ORIGIN',
    'CODEX_APP_RP_ID',
    'CODEX_CREDENTIAL_ENCRYPTION_KEY',
    'CODEX_REMOTE_RELAY_URL',
    'CODEX_REMOTE_RELAY_OWNER_TOKEN',
  ]
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  process.env.NODE_ENV = 'production'
  process.env.CODEX_APP_ORIGIN = 'https://app.example.test'
  process.env.CODEX_APP_RP_ID = 'app.example.test'
  process.env.CODEX_CREDENTIAL_ENCRYPTION_KEY = 'test-key'
  process.env.CODEX_REMOTE_RELAY_URL = 'wss://relay.example.test/ws'
  process.env.CODEX_REMOTE_RELAY_OWNER_TOKEN = 'x'.repeat(32)
  try {
    const config = loadServerConfig()
    assert.equal(config.appOrigin, 'https://app.example.test')
    assert.equal(config.rpId, 'app.example.test')
    assert.equal(config.remoteRelayUrl, 'wss://relay.example.test/ws')
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
