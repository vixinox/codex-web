import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { ServerConfig } from '../config.js'
import type { WorkspaceService } from '../workspace.js'
import { CodexManager } from './manager.js'
import type { RpcTransport } from './rpc-client.js'
import type { JsonRpcMessage } from './stdio-transport.js'

class AutoTransport implements RpcTransport {
  sent: JsonRpcMessage[] = []
  private message?: (message: JsonRpcMessage) => void
  private exit?: (code: number | null, signal: NodeJS.Signals | null) => void
  send(message: JsonRpcMessage) {
    this.sent.push(message)
    if (message.method === 'initialize' || message.method === 'account/login/start')
      queueMicrotask(() => this.message?.({ id: message.id, result: {} }))
    if (message.method === 'account/read')
      queueMicrotask(() =>
        this.message?.({
          id: message.id,
          result: { account: { type: 'apiKey' }, requiresOpenaiAuth: true },
        }),
      )
  }
  stop() {
    this.exit?.(null, 'SIGTERM')
  }
  onMessage(listener: (message: JsonRpcMessage) => void) {
    this.message = listener
    return () => true
  }
  onError() {
    return () => true
  }
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
    this.exit = listener
    return () => true
  }
  crash() {
    this.exit?.(1, null)
  }
  receive(message: JsonRpcMessage) {
    this.message?.(message)
  }
}

const config = {
  dataRoot: './.data/test',
  codexRuntimeVersion: '0.153.0',
} as ServerConfig

const workspace = {
  getProject: async () => ({ id: 'project', name: 'project', path: 'C:/workspace/project' }),
  getCredential: async () => ({
    id: 'credential',
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    encryptedApiKey: 'encrypted',
    apiKey: 'secret',
  }),
} as unknown as WorkspaceService

test('shares one process per user and restarts after exit', async () => {
  const transports: AutoTransport[] = []
  const manager = new CodexManager(config, workspace, () => {
    const transport = new AutoTransport()
    transports.push(transport)
    return transport
  })
  const [first, same] = await Promise.all([
    manager.get('user-a', 'project', 'credential'),
    manager.get('user-a', 'project', 'credential'),
  ])
  assert.equal(first, same)
  assert.equal(transports.length, 1)
  transports[0].crash()
  const restarted = await manager.get('user-a', 'project', 'credential')
  assert.notEqual(restarted, first)
  assert.equal(transports.length, 2)
  await manager.shutdown()
})

test('creates CODEX_HOME before starting the user process', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-web-manager-'))
  const manager = new CodexManager({ ...config, dataRoot }, workspace, (_command, options) => {
    assert.equal(options.env?.CODEX_HOME, path.join(dataRoot, 'users', 'user-a', '.codex'))
    assert.equal(existsSync(options.env.CODEX_HOME), true)
    return new AutoTransport()
  })

  try {
    await manager.get('user-a', 'project', 'credential')
    await manager.shutdown()
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('uses the credential provider as the configured custom provider id', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-web-manager-'))
  const provider = 'example.proxy'
  const namedWorkspace = {
    ...workspace,
    getCredential: async () => ({
      id: 'credential',
      provider,
      baseUrl: 'https://api.example.com',
      encryptedApiKey: 'encrypted',
      apiKey: 'secret',
    }),
  } as unknown as WorkspaceService
  const manager = new CodexManager(
    { ...config, dataRoot },
    namedWorkspace,
    () => new AutoTransport(),
  )

  try {
    await manager.get('user-a', 'project', 'credential')
    const configText = await readFile(
      path.join(dataRoot, 'users', 'user-a', '.codex', 'config.toml'),
      'utf8',
    )
    assert.equal(
      configText,
      [
        'model_provider = "example.proxy"',
        '',
        '[model_providers."example.proxy"]',
        'name = "example.proxy"',
        'base_url = "https://api.example.com"',
        'wire_api = "responses"',
        'requires_openai_auth = true',
        '',
      ].join('\n'),
    )
    await manager.shutdown()
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('routes server requests by user and thread and responds with the original JSON-RPC id', async () => {
  const transport = new AutoTransport()
  const manager = new CodexManager(config, workspace, () => transport)
  await manager.get('user-a', 'project', 'credential')
  const received: JsonRpcMessage[] = []
  manager.events.subscribe('user-a', 'thread-a', 0, (event) => received.push(event.message))
  transport.receive({
    id: 42,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-a', turnId: 'turn-a' },
  })
  assert.equal(received.length, 1)
  assert.throws(
    () => manager.respondToServerRequest('user-a', 'thread-b', 42, 'accept'),
    /not found/,
  )
  manager.respondToServerRequest('user-a', 'thread-a', 42, 'accept')
  assert.deepEqual(transport.sent.at(-1), { id: 42, result: 'accept' })
  await manager.shutdown()
})

test('shutdown rejects queued turns and clears their timers', async () => {
  const queueConfig = { ...config, maxActiveTasksPerUser: 1 }
  const manager = new CodexManager(queueConfig, workspace)
  const running = manager.enqueueTurn(
    'user-a',
    (signal) =>
      new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  )
  const queued = manager.enqueueTurn('user-a', async () => 'never')
  await new Promise((resolve) => setImmediate(resolve))
  const shutdown = manager.shutdown()
  await assert.rejects(queued, /shut down/)
  await assert.rejects(running, /shut down/)
  await shutdown
})

test('cancels the requested queued task instead of the queue head', async () => {
  const queueConfig = { ...config, maxActiveTasksPerUser: 1 }
  const manager = new CodexManager(queueConfig, workspace)
  let release!: () => void
  const first = manager.enqueueTurn(
    'user-a',
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
    120_000,
    'first',
  )
  const second = manager.enqueueTurn('user-a', async () => 'second', 120_000, 'second')
  const third = manager.enqueueTurn('user-a', async () => 'third', 120_000, 'third')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(manager.cancelQueuedTurn('user-a', 'third'), true)
  release()
  await first
  assert.equal(await second, 'second')
  await assert.rejects(third, /cancelled/)
  await manager.shutdown()
})

test('runs different thread scopes in parallel while serializing the same scope', async () => {
  const queueConfig = { ...config, maxActiveTasksPerUser: 2 }
  const manager = new CodexManager(queueConfig, workspace)
  let running = 0
  let peak = 0
  const hold = (scope: string) =>
    manager.enqueueTurn(
      'user-a',
      async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((resolve) => setImmediate(resolve))
        running -= 1
        return scope
      },
      120_000,
      crypto.randomUUID(),
      scope,
    )
  await Promise.all([hold('thread-a'), hold('thread-b')])
  assert.equal(peak, 2)
  await manager.shutdown()
})

test('does not share processes across users', async () => {
  let starts = 0
  const manager = new CodexManager(config, workspace, () => {
    starts += 1
    return new AutoTransport()
  })
  await Promise.all([
    manager.get('user-a', 'project', 'credential'),
    manager.get('user-b', 'project', 'credential'),
  ])
  assert.equal(starts, 2)
  await manager.shutdown()
})

test('keeps the active process when resources change and restarts explicitly', async () => {
  const transports: AutoTransport[] = []
  const starts: Array<{ cwd?: string; envKey?: string }> = []
  const switchingWorkspace = {
    getProject: async (_userId: string, projectId: string) => ({
      id: projectId,
      name: projectId,
      path: `C:/workspace/${projectId}`,
    }),
    getCredential: async (_userId: string, credentialId: string) => ({
      id: credentialId,
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      encryptedApiKey: 'encrypted',
      apiKey: `key-${credentialId}`,
    }),
  } as unknown as WorkspaceService
  const manager = new CodexManager(config, switchingWorkspace, (_command, options) => {
    starts.push({ cwd: options.cwd, envKey: options.env?.OPENAI_API_KEY })
    const transport = new AutoTransport()
    transports.push(transport)
    return transport
  })

  const first = await manager.get('user-a', 'project-a', 'credential-a')
  const second = await manager.get('user-a', 'project-b', 'credential-a')
  const third = await manager.get('user-a', 'project-b', 'credential-b')

  assert.equal(first, second)
  assert.equal(second, third)
  assert.equal(manager.getStatus('user-a').restartRequired, true)
  await manager.restart('user-a', 'project-b', 'credential-b')
  assert.equal(transports.length, 2)
  assert.equal(manager.getStatus('user-a').activeCredentialId, 'credential-b')
  assert.equal(starts.length, 2)
  assert.equal(starts[0]?.envKey, undefined)
  assert.equal(starts[1]?.envKey, undefined)
  await manager.shutdown()
})
