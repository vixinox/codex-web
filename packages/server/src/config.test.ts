import assert from 'node:assert/strict'
import test from 'node:test'

import { loadServerConfig } from './config.js'

test('rejects non-loopback server hosts', () => {
  const names = [
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'SERVER_HOST',
    'CODEX_CREDENTIAL_ENCRYPTION_KEY',
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
