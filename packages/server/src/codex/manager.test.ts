import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

import type { ServerConfig } from '../config.js'
import type { WorkspaceService } from '../workspace.js'
import { CodexManager } from './manager.js'
import { CodexRuntimeManager } from './runtime-manager.js'
import type { RpcTransport } from './rpc-client.js'
import type { JsonRpcMessage } from './stdio-transport.js'
import { log } from '../logger.js'
import { isConversationChange } from '@codex-web/protocol/owner'

class AutoTransport implements RpcTransport {
  sent: JsonRpcMessage[] = []
  private message?: (message: JsonRpcMessage) => void
  private exit?: (code: number | null, signal: string | null) => void
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
  onExit(listener: (code: number | null, signal: string | null) => void) {
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

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-web-manager-suite-'))
after(() => rm(dataRoot, { recursive: true, force: true }))
const config = { dataRoot } as ServerConfig

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

test('startup completion waits for runtime manifest bookkeeping', async () => {
  let release!: () => void
  let entered!: () => void
  const bookkeeping = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const runtime = new CodexRuntimeManager(config)
  runtime.markRestarted = async () => {
    entered()
    await bookkeeping
  }
  const manager = new CodexManager(config, workspace, () => new AutoTransport(), runtime)
  let settled = false
  const startup = manager.get('bookkeeping-user', 'project', 'credential').then((client) => {
    settled = true
    return client
  })
  try {
    await started
    assert.equal(settled, false)
  } finally {
    release()
    await startup
    await manager.shutdown()
  }
})

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
        'web_search = "live"',
        '',
        '[tools.web_search]',
        '',
      ].join('\n'),
    )
    await manager.shutdown()
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})

test('provider endpoint logging excludes URL credentials, paths, and query values', async (context) => {
  const fieldsCaptured: Record<string, unknown>[] = []
  context.mock.method(log, 'info', (event: string, fields: Record<string, unknown>) => {
    if (event === 'codex.provider.configured') fieldsCaptured.push(fields)
  })
  const privateEndpointWorkspace = {
    ...workspace,
    getCredential: async () => ({
      id: 'credential',
      provider: 'private-provider',
      baseUrl: 'https://user:password@api.example.com/private/path?token=query-secret',
      encryptedApiKey: 'encrypted',
      apiKey: 'secret',
    }),
  } as unknown as WorkspaceService
  const manager = new CodexManager(config, privateEndpointWorkspace, () => new AutoTransport())
  await manager.get('user-a', 'project', 'credential')
  assert.equal(fieldsCaptured[0]?.endpointHost, 'api.example.com')
  assert.doesNotMatch(JSON.stringify(fieldsCaptured), /password|private\/path|query-secret/u)
  await manager.shutdown()
})

test('routes server requests by user and thread and responds with the original JSON-RPC id', async (context) => {
  const transport = new AutoTransport()
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-web-manager-'))
  const manager = new CodexManager({ ...config, dataRoot }, workspace, () => transport)
  context.after(async () => {
    await manager.shutdown()
    await rm(dataRoot, { recursive: true, force: true })
  })
  await manager.get('user-a', 'project', 'credential')
  const changes = observeInteractionChanges(manager, 'thread-a')
  const approval = {
    id: 42,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-a', turnId: 'turn-a' },
  }
  transport.receive(approval)
  transport.receive(approval)
  assert.equal(changes.length, 1)
  const opened = changes[0]
  assert.ok(opened?.type === 'interaction.opened')
  const interactionId = opened.interaction.id
  assert.throws(
    () => manager.respondToServerRequest('user-a', 'thread-b', interactionId, 'accept'),
    /not found/,
  )
  assert.throws(
    () => manager.respondToServerRequest('user-b', 'thread-a', interactionId, 'accept'),
    /not found/,
  )
  manager.respondToServerRequest('user-a', 'thread-a', interactionId, 'accept')
  assert.deepEqual(transport.sent.at(-1), { id: 42, result: 'accept' })
  transport.receive({
    method: 'serverRequest/resolved',
    params: { threadId: 'thread-a', requestId: 42 },
  })
  assert.equal(changes.length, 2)
  const resolved = changes[1]
  assert.ok(resolved?.type === 'interaction.resolved')
  assert.equal(resolved.interactionId, opened.interaction.id)
  assert.deepEqual(resolved.outcome, { kind: 'approved' })
  assert.throws(
    () => manager.respondToServerRequest('user-a', 'thread-a', interactionId, 'accept'),
    /not found/,
  )

  transport.receive({
    id: 'request-43',
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread-a',
      turnId: 'turn-a',
      itemId: 'item-a',
      isBlocking: true,
      questions: [{ id: 'secret', question: 'Token?', isSecret: true }],
    },
  })
  const input = changes[2]
  assert.ok(input?.type === 'interaction.opened')
  assert.equal(input.interaction.activityId, 'item-a')
  const result = { answers: { secret: { answers: ['private-answer-fixture'] } } }
  manager.respondToServerRequest('user-a', 'thread-a', input.interaction.id, result)
  assert.deepEqual(transport.sent.at(-1), { id: 'request-43', result })
  const submitted = changes[3]
  assert.ok(submitted?.type === 'interaction.resolved')
  assert.equal(submitted.interactionId, input.interaction.id)
  assert.deepEqual(submitted.outcome, {
    kind: 'answers',
    answers: { secret: ['private-answer-fixture'] },
  })
  assert.match(JSON.stringify(changes), /private-answer-fixture/u)
})

test('terminates pending interactions on turn interruption and runtime disconnect without reusing public ids', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-web-manager-'))
  let transport = new AutoTransport()
  const manager = new CodexManager({ ...config, dataRoot }, workspace, () => transport)
  context.after(async () => {
    await manager.shutdown()
    await rm(dataRoot, { recursive: true, force: true })
  })
  await manager.get('user-a', 'project', 'credential')
  const changes = observeInteractionChanges(manager, 'thread-a')
  const request = (id: string | number, turnId: string) => ({
    id,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-a', turnId },
  })
  transport.receive(request(44, 'cancelled-turn'))
  transport.receive(request('44', 'surviving-turn'))
  const cancelled = changes[0]
  const disconnected = changes[1]
  assert.ok(cancelled?.type === 'interaction.opened')
  assert.ok(disconnected?.type === 'interaction.opened')
  transport.receive({
    method: 'turn/completed',
    params: { threadId: 'thread-a', turn: { id: 'cancelled-turn', status: 'interrupted' } },
  })
  assert.equal(changes.length, 3)
  const turnTerminal = changes[2]
  assert.ok(turnTerminal?.type === 'interaction.cancelled')
  assert.equal(turnTerminal.interactionId, cancelled.interaction.id)
  assert.equal(turnTerminal.status, 'cancelled')
  transport.crash()
  const runtimeTerminal = changes[3]
  assert.ok(runtimeTerminal?.type === 'interaction.cancelled')
  assert.equal(runtimeTerminal.interactionId, disconnected.interaction.id)
  assert.equal(runtimeTerminal.status, 'expired')
  transport = new AutoTransport()
  await manager.get('user-a', 'project', 'credential')
  transport.receive(request('44', 'new-turn'))
  const reopened = changes[4]
  assert.ok(reopened?.type === 'interaction.opened')
  assert.notEqual(reopened.interaction.id, disconnected.interaction.id)
  const stale = disconnected.interaction.id
  assert.throws(
    () => manager.respondToServerRequest('user-a', 'thread-a', stale, 'accept'),
    /not found/,
  )
  transport.receive({
    method: 'serverRequest/resolved',
    params: { threadId: 'thread-b', requestId: '44' },
  })
  assert.equal(changes.length, 5)
  transport.receive({
    method: 'serverRequest/resolved',
    params: { threadId: 'thread-a', requestId: '44' },
  })
  const externallyResolved = changes[5]
  assert.ok(externallyResolved?.type === 'interaction.resolved')
  assert.equal(externallyResolved.interactionId, reopened.interaction.id)
  assert.deepEqual(externallyResolved.outcome, { kind: 'dismissed' })
})

test('routes plain file approvals and rejects unsupported Codex 0.167.0 requests', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-web-manager-'))
  const transport = new AutoTransport()
  const manager = new CodexManager({ ...config, dataRoot }, workspace, () => transport)
  context.after(async () => {
    await manager.shutdown()
    await rm(dataRoot, { recursive: true, force: true })
  })
  await manager.get('user-a', 'project', 'credential')
  const changes = observeInteractionChanges(manager, 'thread-a')
  const params = {
    threadId: 'thread-a',
    turnId: 'turn-a',
    itemId: 'file-change-a',
    startedAtMs: 1_767_225_600_000,
    reason: 'private-path-fixture',
    grantRoot: null,
  }
  const method = 'item/fileChange/requestApproval'
  transport.receive({ id: 'file-approval', method, params })
  const opened = changes[0]
  assert.ok(opened?.type === 'interaction.opened')
  assert.equal(opened.interaction.activityId, 'file-change-a')
  assert.equal(
    opened.interaction.details?.kind === 'approval' ? opened.interaction.details.reason : undefined,
    'private-path-fixture',
  )
  const interactionId = opened.interaction.id
  const beforeInvalid = transport.sent.length
  assert.throws(
    () =>
      manager.respondToServerRequest('user-a', 'thread-a', interactionId, { decision: 'accept' }),
    /Invalid file change approval decision/,
  )
  assert.equal(transport.sent.length, beforeInvalid)
  manager.respondToServerRequest('user-a', 'thread-a', interactionId, 'decline')
  assert.deepEqual(transport.sent.at(-1), { id: 'file-approval', result: { decision: 'decline' } })
  assert.throws(
    () => manager.respondToServerRequest('user-a', 'thread-a', interactionId, 'decline'),
    /not found/,
  )
  const resolved = changes[1]
  assert.ok(resolved?.type === 'interaction.resolved')
  assert.equal(resolved.interactionId, opened.interaction.id)
  assert.deepEqual(resolved.outcome, { kind: 'rejected' })

  transport.receive({
    id: 'grant-root',
    method,
    params: { ...params, grantRoot: 'C:/private-path-fixture' },
  })
  assert.deepEqual(transport.sent.at(-1), {
    id: 'grant-root',
    error: { code: -32602, message: 'Invalid interaction request' },
  })
  const unsupported = [
    ['mcpServer/elicitation/request', { threadId: 'thread-a', turnId: null }],
    ['item/permissions/requestApproval', params],
    ['item/tool/call', params],
    ['account/chatgptAuthTokens/refresh', { reason: 'unauthorized' }],
    ['attestation/generate', {}],
    ['applyPatchApproval', { conversationId: 'thread-a' }],
    ['execCommandApproval', { conversationId: 'thread-a' }],
  ] as const
  for (const [unsupportedMethod, unsupportedParams] of unsupported) {
    transport.receive({
      id: unsupportedMethod,
      method: unsupportedMethod,
      params: unsupportedParams,
    })
    assert.deepEqual(transport.sent.at(-1), {
      id: unsupportedMethod,
      error: { code: -32601, message: 'Unsupported interaction request' },
    })
  }
  assert.equal(changes.length, 2)
  assert.match(JSON.stringify(changes), /private-path-fixture/u)
})

function observeInteractionChanges(manager: CodexManager, threadId: string) {
  const changes: Extract<
    import('@codex-web/conversation').ConversationChange,
    { type: `interaction.${string}` }
  >[] = []
  manager.events.subscribe('user-a', threadId, 0, ({ message }) => {
    assert.equal(message.type, 'conversation.change')
    assert.doesNotMatch(JSON.stringify(message), /"rpcId":|"correlationId":/u)
    const change = message.payload.change
    assert.ok(isConversationChange(change))
    if (
      change.type === 'interaction.opened' ||
      change.type === 'interaction.resolved' ||
      change.type === 'interaction.cancelled'
    )
      changes.push(change)
  })
  return changes
}

test('logs server requests before rejecting requests without a thread id', async (context) => {
  const lines: string[] = []
  context.mock.method(log, 'info', (event: string, fields: Record<string, unknown>) => {
    if (event === 'codex.rpc.message') lines.push(JSON.stringify(fields))
  })
  const transport = new AutoTransport()
  const manager = new CodexManager(config, workspace, () => transport)
  await manager.get('user-a', 'project', 'credential')
  lines.length = 0

  transport.receive({ id: 45, method: 'future/request', params: { futureField: 'private value' } })

  assert.equal(transport.sent.at(-1)?.id, 45)
  assert.equal(transport.sent.at(-1)?.error && typeof transport.sent.at(-1)?.error, 'object')
  assert.equal(lines.length, 1)
  assert.match(
    lines[0]!,
    /"direction":"server-request".*"method":"future\/request".*futureField:string\(chars=13\)/,
  )
  assert.doesNotMatch(lines[0]!, /private value/)
  await manager.shutdown()
})

test('shutdown rejects queued turns and clears their timers', async () => {
  const manager = new CodexManager(config, workspace)
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
  const manager = new CodexManager(config, workspace)
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

test('runs all distinct thread scopes concurrently without an app-level task cap', async () => {
  const manager = new CodexManager(config, workspace)
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
  await Promise.all(Array.from({ length: 12 }, (_, index) => hold(`thread-${index}`)))
  assert.equal(peak, 12)
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
