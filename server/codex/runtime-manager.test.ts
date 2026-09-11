import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { ServerConfig } from '../config.js'
import { CodexRuntimeManager, SUPPORTED_CODEX_RANGE, targetFor } from './runtime-manager.js'

function config(dataRoot: string, codexRuntimeVersion: string | null = null): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    databaseUrl: 'postgresql://unused',
    databaseSsl: false,
    authSecret: 'test-secret-that-is-at-least-32-characters',
    authUrl: 'http://127.0.0.1:3000',
    trustedOrigins: ['http://localhost:5173'],
    codexRuntimeVersion,
    dataRoot,
    maxActiveTasksPerUser: 2,
    credentialEncryptionKey: 'test-encryption-key',
    allowedOutboundSchemes: ['https'],
    allowedOutboundHosts: ['api.example.com'],
  }
}

test('maps only supported release targets', () => {
  assert.equal(
    targetFor('win32', 'x64').assetName,
    'codex-app-server-package-x86_64-pc-windows-msvc.tar.gz',
  )
  assert.deepEqual(targetFor('win32', 'x64').requiredFiles, [
    'codex-package.json',
    'bin/codex-app-server.exe',
    'bin/codex-code-mode-host.exe',
    'codex-path/rg.exe',
    'codex-resources/codex-command-runner.exe',
    'codex-resources/codex-windows-sandbox-setup.exe',
  ])
  assert.equal(
    targetFor('darwin', 'arm64').assetName,
    'codex-app-server-package-aarch64-apple-darwin.tar.gz',
  )
  assert.equal(targetFor('linux', 'x64').id, 'linux-x64')
  assert.throws(() => targetFor('freebsd', 'x64'), /not supported/)
  assert.deepEqual(SUPPORTED_CODEX_RANGE, { minimum: [0, 153, 0], maximum: [0, 153, 99] })
})

test('discovers a compatible candidate without changing the active runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-web-runtime-test-'))
  const release = {
    tag_name: 'rust-v0.153.4',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'codex-app-server-package-x86_64-pc-windows-msvc.tar.gz',
        browser_download_url:
          'https://github.com/openai/codex/releases/download/rust-v0.153.4/app.tar.gz',
        digest: `sha256:${'a'.repeat(64)}`,
      },
    ],
  }
  const request: typeof fetch = async () => Response.json(release)
  try {
    const manager = new CodexRuntimeManager(config(root), request, 'win32', 'x64')
    const checked = await manager.check('0.153.4')
    assert.equal(checked.activeVersion, null)
    assert.equal(checked.candidateVersion, '0.153.4')
    assert.equal(checked.candidateStatus, 'pending')
    assert.equal(checked.requestedVersion, '0.153.4')

    const reloaded = new CodexRuntimeManager(config(root), request, 'win32', 'x64')
    const persisted = await reloaded.status()
    assert.equal(persisted.candidateVersion, '0.153.4')
    assert.equal(persisted.candidateStatus, 'pending')
    await assert.rejects(reloaded.resolveCommand(), /Download and verify/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('records an offline release check without discarding the usable state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-web-runtime-test-'))
  const request: typeof fetch = async () => {
    throw new Error('network offline')
  }
  try {
    const manager = new CodexRuntimeManager(config(root), request, 'win32', 'x64')
    const checked = await manager.check()
    assert.equal(checked.activeVersion, null)
    assert.match(checked.lastError ?? '', /network offline/)
    assert.equal(checked.candidateStatus, 'none')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('uses a verified complete package without contacting GitHub during bootstrap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-web-runtime-test-'))
  let requests = 0
  const request: typeof fetch = async () => {
    requests += 1
    throw new Error('network should not be used')
  }
  try {
    const runtimeRoot = path.join(root, 'runtime')
    const packageRoot = path.join(runtimeRoot, 'releases', '0.153.0', 'windows-x64')
    const executable = path.join(packageRoot, 'bin', 'codex-app-server.exe')
    await mkdir(path.join(packageRoot, 'bin'), { recursive: true })
    await mkdir(path.join(packageRoot, 'codex-path'), { recursive: true })
    await mkdir(path.join(packageRoot, 'codex-resources'), { recursive: true })
    await writeFile(executable, 'verified-runtime')
    for (const relativePath of [
      'codex-package.json',
      'bin/codex-code-mode-host.exe',
      'codex-path/rg.exe',
      'codex-resources/codex-command-runner.exe',
      'codex-resources/codex-windows-sandbox-setup.exe',
    ]) {
      await writeFile(path.join(packageRoot, relativePath), '')
    }
    const sha256 = createHash('sha256').update('verified-runtime').digest('hex')
    await writeFile(
      path.join(runtimeRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        channel: 'stable',
        requestedVersion: null,
        active: {
          version: '0.153.0',
          platform: 'windows-x64',
          assetName: 'codex-app-server-package-x86_64-pc-windows-msvc.tar.gz',
          executablePath: executable,
          sha256,
          verifiedAt: new Date().toISOString(),
        },
        previous: null,
        candidate: null,
        restartRequired: false,
        lastCheckedAt: null,
        lastCheckError: null,
      }),
    )
    const manager = new CodexRuntimeManager(config(root), request, 'win32', 'x64')
    const runtime = await manager.ensureRuntime()
    assert.equal(runtime.version, '0.153.0')
    assert.equal(runtime.executablePath, executable)
    assert.equal(requests, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
