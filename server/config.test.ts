import assert from 'node:assert/strict'
import test from 'node:test'

import { loadServerConfig } from './config.js'

const guestEnvironment = {
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
  BETTER_AUTH_URL: 'http://127.0.0.1:3000',
  DATABASE_URL: 'postgresql://unused',
  GUEST_CODEX_PROVIDER: 'guest-provider',
  GUEST_CODEX_BASE_URL: 'https://api.example.com/v1',
  GUEST_CODEX_API_KEY: 'guest-secret',
}

test('loads the Guest context window from a safe integer configuration', () => {
  const previous = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(guestEnvironment)) {
    previous.set(name, process.env[name])
    process.env[name] = value
  }
  const previousContextWindow = process.env.GUEST_MODEL_CONTEXT_WINDOW
  try {
    delete process.env.GUEST_MODEL_CONTEXT_WINDOW
    expectGuestContextWindow(256_000)

    process.env.GUEST_MODEL_CONTEXT_WINDOW = '128000'
    expectGuestContextWindow(128_000)

    for (const invalid of ['0', '-1', '1.5', '9007199254740992', 'not-a-number']) {
      process.env.GUEST_MODEL_CONTEXT_WINDOW = invalid
      assert.throws(() => loadServerConfig('guest'), /GUEST_MODEL_CONTEXT_WINDOW/)
    }
  } finally {
    if (previousContextWindow === undefined) delete process.env.GUEST_MODEL_CONTEXT_WINDOW
    else process.env.GUEST_MODEL_CONTEXT_WINDOW = previousContextWindow
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('loads the per-user active task limit for Guest runtime admission', () => {
  const previous = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(guestEnvironment)) {
    previous.set(name, process.env[name])
    process.env[name] = value
  }
  const previousLimit = process.env.CODEX_MAX_ACTIVE_TASKS_PER_USER
  try {
    process.env.CODEX_MAX_ACTIVE_TASKS_PER_USER = '3'
    assert.equal(loadServerConfig('guest').maxActiveTasksPerUser, 3)
  } finally {
    if (previousLimit === undefined) delete process.env.CODEX_MAX_ACTIVE_TASKS_PER_USER
    else process.env.CODEX_MAX_ACTIVE_TASKS_PER_USER = previousLimit
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

function expectGuestContextWindow(expected: number) {
  assert.equal(loadServerConfig('guest').guest?.modelContextWindow, expected)
}
