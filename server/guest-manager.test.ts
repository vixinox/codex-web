import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import type { ServerConfig } from './config.js'
import { CodexRuntimeManager } from './codex/runtime-manager.js'
import { extractWindowsConfig, GuestCodexManager } from './guest-manager.js'

function manager(dataRoot: string) {
  const config: ServerConfig = {
    mode: 'guest',
    host: '127.0.0.1',
    port: 3000,
    databaseUrl: 'postgresql://unused',
    databaseSsl: false,
    authSecret: '',
    authUrl: 'http://127.0.0.1:3000',
    trustedOrigins: [],
    codexRuntimeVersion: null,
    dataRoot,
    maxActiveTasksPerUser: 2,
    credentialEncryptionKey: '',
    allowedOutboundSchemes: ['https'],
    allowedOutboundHosts: ['api.openai.com'],
    guest: {
      provider: 'guest',
      baseUrl: 'https://example.invalid',
      apiKey: 'secret',
      skillRoots: [],
      leaseTtlHours: 24,
      globalDailyTokenLimit: 1_000_000,
      perGuestDailyTokenLimit: 128_000,
      maxActiveThreads: 5,
      maxQueue: 20,
      maxTokensPerTurn: 16_000,
      modelContextWindow: 256_000,
    },
  }
  return new GuestCodexManager(config, new CodexRuntimeManager(config))
}

test('preserves Windows sandbox configuration when rebuilding Guest config', () => {
  assert.equal(
    extractWindowsConfig(
      '[windows]\n' +
        'sandbox = "elevated"\n' +
        '\n' +
        '[model_providers.guest]\n' +
        'base_url = "https://example.invalid"\n',
    ),
    '[windows]\nsandbox = "elevated"',
  )
})

test('creates an empty private workspace for the lease', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-web-guest-'))
  try {
    const workspace = await manager(root).prepareWorkspace('11111111-1111-4111-8111-111111111111')
    assert.equal(
      workspace,
      path.join(root, 'guest', 'workspaces', '11111111-1111-4111-8111-111111111111'),
    )
    assert.deepEqual(await readdir(workspace), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects invalid lease ids', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-web-guest-'))
  try {
    const guest = manager(root)
    await assert.rejects(() => guest.prepareWorkspace('../escape'), /identity/)
    await assert.rejects(() => guest.prepareWorkspace('not-a-lease-id'), /identity/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
