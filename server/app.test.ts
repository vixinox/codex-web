import assert from 'node:assert/strict'
import test from 'node:test'

import type { Auth } from './auth.js'
import { buildOwnerServer } from './owner/app.js'
import { createSseWriter, resolveEventCursor } from './http/common.js'
import type { ServerConfig } from './config.js'
import { EventHub } from './codex/event-hub.js'
import type { WorkspaceService } from './workspace.js'

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3000,
  databaseUrl: 'postgresql://unused',
  databaseSsl: false,
  authSecret: 'test-secret-that-is-at-least-32-characters',
  authUrl: 'http://127.0.0.1:3000',
  trustedOrigins: ['http://localhost:5173'],
  codexRuntimeVersion: '0.153.0',
  dataRoot: './.data/codex',
  maxActiveTasksPerUser: 2,
  credentialEncryptionKey: 'test-encryption-key',
  allowedOutboundSchemes: ['https'],
  allowedOutboundHosts: ['api.example.com'],
}

function fakeAuth(options: { session?: object | null; fail?: boolean } = {}) {
  return {
    handler: async (request: Request) => {
      if (options.fail) throw new Error('private database detail')
      return Response.json(
        { path: new URL(request.url).pathname },
        {
          status: 201,
          headers: { 'set-cookie': 'session=test; Path=/; HttpOnly' },
        },
      )
    },
    api: {
      getSession: async () => options.session ?? null,
    },
  } as unknown as Auth
}

const workspace = {
  getUserRoot: () => 'C:/test',
  listProjects: async () => [],
  listProjectLocations: async () => [{ id: 'project-id', path: 'C:/test/demo' }],
  createProject: async () => ({
    id: 'project-id',
    name: 'demo',
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  renameProject: async () => ({
    id: 'project-id',
    name: 'renamed',
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  deleteProject: async () => true,
  getProject: async () => ({
    id: 'project-id',
    name: 'demo',
    path: 'C:/test/demo',
  }),
  listCredentials: async () => [],
  getCredential: async () => ({
    id: 'credential-id',
    provider: 'openai',
    baseUrl: 'https://api.example.com',
    encryptedApiKey: 'encrypted',
    apiKey: 'secret',
  }),
  testCredential: async () => true,
  saveCredential: async () => ({
    id: 'credential-id',
    provider: 'openai',
    baseUrl: 'https://api.example.com',
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  deleteCredential: async () => true,
  getCurrentCredentialId: async () => null,
  setCurrentCredentialId: async () => true,
}

const thread = {
  id: 'thread-id',
  cwd: 'C:/test/demo',
  name: null,
  preview: 'Example thread',
  status: { type: 'idle' },
  createdAt: 1,
  updatedAt: 2,
  recencyAt: 2,
  modelProvider: 'openai',
  ephemeral: false,
  parentThreadId: null,
  turns: [],
  path: 'C:/private/thread.jsonl',
}

const codex = {
  get: async () => ({
    request: async (method: string) =>
      method === 'thread/list'
        ? { data: [thread], nextCursor: null }
        : method === 'turn/start'
          ? { turn: { id: 'turn-id', status: 'inProgress', items: [] } }
          : { thread },
  }),
  getReady: async () => ({
    request: async (method: string) =>
      method === 'thread/list'
        ? { data: [thread], nextCursor: null }
        : method === 'turn/start'
          ? { turn: { id: 'turn-id', status: 'inProgress', items: [] } }
          : { thread },
  }),
  getStatus: () => ({
    status: 'ready',
    projectId: 'project-id',
    activeCredentialId: 'credential-id',
    pendingCredentialId: null,
    restartRequired: false,
    activeTurns: 0,
    error: null,
  }),
  start: async () => {},
  restart: async () => {},
  markCredentialPending: () => {},
  stop: async () => {},
  shutdown: async () => {},
  events: { latestEventId: () => 0, subscribe: () => () => {} },
}

test('resolves event cursors from Last-Event-ID before the query cursor', () => {
  assert.equal(resolveEventCursor(undefined, undefined), 0)
  assert.equal(resolveEventCursor(undefined, '8'), 8)
  assert.equal(resolveEventCursor('12', '8'), 12)
  assert.equal(resolveEventCursor('0', '8'), 0)
  assert.equal(resolveEventCursor('12', 'invalid'), 12)
  assert.equal(resolveEventCursor('invalid', '8'), null)
  assert.equal(resolveEventCursor(undefined, '-1'), null)
  assert.equal(resolveEventCursor(undefined, '1.5'), null)
})

test('keeps one drain listener while an SSE response is backpressured', () => {
  const listeners = new Set<() => void>()
  const writes: string[] = []
  const response = {
    write: (frame: string) => {
      writes.push(frame)
      return false
    },
    once: (_event: 'drain', listener: () => void) => listeners.add(listener),
    removeListener: (_event: 'drain', listener: () => void) => listeners.delete(listener),
  }
  const writer = createSseWriter(response)

  for (let index = 0; index < 20; index += 1) writer.write(`event-${index}`)
  assert.equal(listeners.size, 1)
  assert.deepEqual(writes, ['event-0'])

  const drain = [...listeners][0]
  if (drain) {
    listeners.delete(drain)
    drain()
  }
  assert.equal(listeners.size, 1)
  assert.deepEqual(writes, ['event-0', 'event-1'])
})

test('reads and writes the scoped context window configuration', async (context) => {
  const session = { session: { id: 'session-id' }, user: { id: 'user-id' } }
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const configurationCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })
        return method === 'config/read' ? { config: { model_context_window: 123456 } } : {}
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: configurationCodex,
  })
  context.after(() => app.close())

  const read = await app.inject({ method: 'GET', url: '/api/configuration/context-window' })
  assert.equal(read.statusCode, 200)
  assert.deepEqual(read.json(), { modelContextWindow: 123456, source: 'configured' })

  const write = await app.inject({
    method: 'PUT',
    url: '/api/configuration/context-window',
    payload: { modelContextWindow: 654321 },
  })
  assert.equal(write.statusCode, 200)
  assert.deepEqual(write.json(), { modelContextWindow: 654321, source: 'configured' })
  assert.deepEqual(requests.at(-1), {
    method: 'config/value/write',
    params: { keyPath: 'model_context_window', value: 654321, mergeStrategy: 'replace' },
  })
})

test('falls back to 256k and rejects invalid context window values', async (context) => {
  const session = { session: { id: 'session-id' }, user: { id: 'user-id' } }
  let writes = 0
  const configurationCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string) => {
        if (method === 'config/value/write') writes += 1
        return { config: {} }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: configurationCodex,
  })
  context.after(() => app.close())
  const read = await app.inject({ method: 'GET', url: '/api/configuration/context-window' })
  assert.deepEqual(read.json(), { modelContextWindow: 256000, source: 'default' })
  const write = await app.inject({
    method: 'PUT',
    url: '/api/configuration/context-window',
    payload: { modelContextWindow: 0 },
  })
  assert.equal(write.statusCode, 400)
  assert.equal(writes, 0)
})

test('rejects an invalid SSE query cursor before opening the Codex stream', async (context) => {
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-id' } } }),
    workspace,
    codex,
  })
  context.after(() => app.close())
  const response = await app.inject({
    method: 'GET',
    url: '/api/events?threadId=thread-id&afterId=not-a-number',
  })
  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.json(), {
    error: { code: 'INVALID_EVENT_CURSOR', message: 'Invalid event cursor' },
  })
})

test('forwards Better Auth responses and cookies', async (context) => {
  const app = await buildOwnerServer(config, { auth: fakeAuth(), workspace, codex })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    payload: { email: 'a@example.com' },
  })
  assert.equal(response.statusCode, 201)
  assert.match(String(response.headers['set-cookie']), /session=test/)
  assert.deepEqual(response.json(), { path: '/api/auth/sign-in/email' })
})

test('starts Codex with the current credential when credentialId is omitted', async (context) => {
  let startedWith: string | undefined
  let persistedCurrent = ''
  const activeWorkspace = {
    ...workspace,
    getCredential: async () => workspace.getCredential(),
    getCurrentCredentialId: async () => 'credential-id',
    setCurrentCredentialId: async (_userId: string, credentialId: string) => {
      persistedCurrent = credentialId
      return true
    },
  }
  const activeCodex = {
    ...codex,
    start: async (_userId: string, _projectId: string, credentialId: string) => {
      startedWith = credentialId
    },
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-1' } } }),
    workspace: activeWorkspace,
    codex: activeCodex,
  })
  context.after(() => app.close())
  const response = await app.inject({
    method: 'POST',
    url: '/api/codex/start',
    payload: {},
  })
  assert.equal(response.statusCode, 200)
  assert.equal(startedWith, 'credential-id')
  assert.equal(persistedCurrent, 'credential-id')
  assert.equal(response.json().currentCredentialId, 'credential-id')
})

test('requires explicit dangerous-access confirmation in production mode', async (context) => {
  const app = await buildOwnerServer(
    { ...config, requireDangerousAccessConfirmation: true },
    {
      auth: fakeAuth({ session: { user: { id: 'user-1' } } }),
      workspace: { ...workspace, getCurrentCredentialId: async () => 'credential-id' },
      codex,
    },
  )
  context.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/codex/start', payload: {} })
  assert.equal(response.statusCode, 428)
  assert.equal(response.json().error.code, 'CODEX_DANGEROUS_ACCESS_CONFIRMATION_REQUIRED')
})

test('reports persisted and active credentials as separate runtime fields', async (context) => {
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-1' } } }),
    workspace: {
      ...workspace,
      getCurrentCredentialId: async () => 'credential-current',
    },
    codex,
  })
  context.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/codex/status' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().activeCredentialId, 'credential-id')
  assert.equal(response.json().currentCredentialId, 'credential-current')
})

test('requires a profile when starting Codex without an active credential', async (context) => {
  const stoppedCodex = {
    ...codex,
    getStatus: () => ({
      status: 'stopped',
      projectId: null,
      activeCredentialId: null,
      pendingCredentialId: null,
      restartRequired: false,
      activeTurns: 0,
      error: null,
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-1' } } }),
    workspace,
    codex: stoppedCodex,
  })
  context.after(() => app.close())
  const response = await app.inject({
    method: 'POST',
    url: '/api/codex/start',
    payload: {},
  })
  assert.equal(response.statusCode, 409)
  assert.equal(response.json().error.code, 'CODEX_PROFILE_REQUIRED')
})

test('lists the persisted current credential without exposing secrets', async (context) => {
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-1' } } }),
    workspace: {
      ...workspace,
      getCurrentCredentialId: async () => 'credential-id',
    },
    codex,
  })
  context.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/credentials' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    credentials: [],
    currentCredentialId: 'credential-id',
  })
  assert.doesNotMatch(response.body, /apiKey|encryptedApiKey|secret/)
})

test('updates the current credential only when it belongs to the user', async (context) => {
  let selected = ''
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-1' } } }),
    workspace: {
      ...workspace,
      setCurrentCredentialId: async (_userId: string, credentialId: string) => {
        selected = credentialId
        return credentialId === 'credential-id'
      },
    },
    codex,
  })
  context.after(() => app.close())

  const selectedResponse = await app.inject({
    method: 'PUT',
    url: '/api/credentials/current',
    payload: { credentialId: 'credential-id' },
  })
  const missingResponse = await app.inject({
    method: 'PUT',
    url: '/api/credentials/current',
    payload: { credentialId: 'other-credential' },
  })

  assert.equal(selectedResponse.statusCode, 200)
  assert.deepEqual(selectedResponse.json(), { currentCredentialId: 'credential-id' })
  assert.equal(missingResponse.statusCode, 404)
  assert.equal(missingResponse.json().error.code, 'CREDENTIAL_NOT_FOUND')
  assert.equal(selected, 'other-credential')
})

test('rejects unauthenticated protected requests with the API error shape', async (context) => {
  const app = await buildOwnerServer(config, { auth: fakeAuth(), workspace, codex })
  context.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/me' })
  assert.equal(response.statusCode, 401)
  assert.deepEqual(response.json(), {
    error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
  })
})

test('returns the authenticated session', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: 'session=test' },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), session)
})

test('lists only the authenticated user projects without a server path', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let listedUserId = ''
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace: {
      ...workspace,
      listProjects: async (userId: string) => {
        listedUserId = userId
        return [
          {
            id: 'project-id',
            name: 'demo',
            createdAt: new Date('2026-08-22T00:00:00.000Z'),
            updatedAt: new Date('2026-08-22T00:00:00.000Z'),
          },
        ]
      },
    },
    codex,
  })
  context.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/projects' })
  assert.equal(response.statusCode, 200)
  assert.equal(listedUserId, 'user-id')
  assert.deepEqual(response.json(), {
    projects: [
      {
        id: 'project-id',
        name: 'demo',
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    ],
  })
  assert.doesNotMatch(response.body, /C:\\|private|path/)
})

test('creates, renames and removes only the authenticated user Project without exposing paths', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const calls: string[] = []
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace: {
      ...workspace,
      createProject: async (userId: string, name: string) => {
        calls.push(`create:${userId}:${name}`)
        return { id: 'new-id', name, createdAt: new Date(0), updatedAt: new Date(0) }
      },
      renameProject: async (userId: string, id: string, name: string) => {
        calls.push(`rename:${userId}:${id}:${name}`)
        return { id, name, createdAt: new Date(0), updatedAt: new Date(1) }
      },
      deleteProject: async (userId: string, id: string) => {
        calls.push(`delete:${userId}:${id}`)
        return true
      },
    },
    codex,
  })
  context.after(() => app.close())

  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'demo' },
  })
  const renamed = await app.inject({
    method: 'PATCH',
    url: '/api/projects/new-id',
    payload: { name: 'renamed' },
  })
  const removed = await app.inject({ method: 'DELETE', url: '/api/projects/new-id' })

  assert.equal(created.statusCode, 201)
  assert.equal(renamed.statusCode, 200)
  assert.equal(removed.statusCode, 204)
  assert.deepEqual(calls, [
    'create:user-id:demo',
    'rename:user-id:new-id:renamed',
    'delete:user-id:new-id',
  ])
  assert.doesNotMatch(created.body + renamed.body, /path|C:\\/)
})

test('returns not found when editing or removing another user Project', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace: {
      ...workspace,
      renameProject: async (): Promise<Awaited<ReturnType<WorkspaceService['renameProject']>>> =>
        undefined,
      deleteProject: async () => false,
    },
    codex,
  })
  context.after(() => app.close())

  const renamed = await app.inject({
    method: 'PATCH',
    url: '/api/projects/missing',
    payload: { name: 'renamed' },
  })
  const removed = await app.inject({ method: 'DELETE', url: '/api/projects/missing' })
  assert.equal(renamed.statusCode, 404)
  assert.equal(removed.statusCode, 404)
})

test('tests a saved credential without returning its secret', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let tested = ''
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace: {
      ...workspace,
      testCredential: async (_userId: string, id: string) => {
        tested = id
        return true
      },
    },
    codex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/credentials/credential-id/test',
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ok: true })
  assert.equal(tested, 'credential-id')
  assert.doesNotMatch(response.body, /secret|apiKey/)
})

test('does not expose authentication handler failures', async (context) => {
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ fail: true }),
    workspace,
    codex,
  })
  context.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/auth/ok' })
  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.json(), {
    error: {
      code: 'AUTH_FAILURE',
      message: 'Authentication service unavailable',
    },
  })
  assert.doesNotMatch(response.body, /private database detail/)
})

test('starts a Project thread and its first Turn through one authenticated command', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/threads',
    payload: {
      projectId: 'project-id',
      text: 'Build the selected project',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    },
  })
  assert.equal(response.statusCode, 201)
  assert.deepEqual(response.json(), {
    threadId: 'thread-id',
    turnId: 'turn-id',
    projectId: 'project-id',
  })
})

test('starts a root Thread in the controlled user workspace', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const requests: { method: string; params?: Record<string, unknown> }[] = []
  const rootThread = { ...thread, cwd: 'C:/test' }
  const rootCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })
        return method === 'thread/start'
          ? { thread: rootThread }
          : { turn: { id: 'root-turn-id', status: 'inProgress', items: [] } }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: rootCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/threads',
    payload: {
      projectId: null,
      text: 'Work across the user workspace',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
    },
  })

  assert.equal(response.statusCode, 201)
  assert.deepEqual(response.json(), {
    threadId: 'thread-id',
    turnId: 'root-turn-id',
    projectId: null,
  })
  assert.deepEqual(requests, [
    {
      method: 'thread/start',
      params: {
        cwd: 'C:/test',
        model: 'gpt-5.6-terra',
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      },
    },
    {
      method: 'turn/start',
      params: {
        threadId: 'thread-id',
        input: [{ type: 'text', text: 'Work across the user workspace' }],
        effort: 'medium',
        collaborationMode: {
          mode: 'plan',
          settings: { model: 'gpt-5.6-terra', reasoning_effort: 'medium' },
        },
      },
    },
  ])
})

test('rejects invalid initial Thread parameters before reaching Codex', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let reachedCodex = false
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: {
      ...codex,
      getReady: async () => {
        reachedCodex = true
        return codex.getReady()
      },
    },
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/threads',
    payload: {
      projectId: null,
      text: '   ',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'extreme',
    },
  })

  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.json(), {
    error: { code: 'INVALID_THREAD_REQUEST', message: 'Invalid initial thread parameters' },
  })
  assert.equal(reachedCodex, false)

  const invalidMode = await app.inject({
    method: 'POST',
    url: '/api/threads',
    payload: {
      projectId: null,
      text: 'Plan this work',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      collaborationMode: 'review',
    },
  })
  assert.equal(invalidMode.statusCode, 400)
  assert.equal(invalidMode.json().error.code, 'INVALID_THREAD_REQUEST')
  assert.equal(reachedCodex, false)
})

test('logs every non-2xx HTTP response with request context', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex,
  })
  context.after(() => app.close())

  const output: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => output.push(args.join(' '))
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/threads',
      payload: {
        projectId: null,
        text: '   ',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      },
    })
    assert.equal(response.statusCode, 400)
  } finally {
    console.error = originalError
  }

  assert.equal(output.length, 1)
  assert.match(output[0], /HTTP 400 POST \/api\/threads/)
  assert.match(output[0], /requestId=/)
})

test('starts a subsequent root Turn only after verifying Thread ownership', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const requests: { method: string; params?: Record<string, unknown> }[] = []
  const rootThread = { ...thread, cwd: 'C:/test' }
  const rootCodex = {
    ...codex,
    ensureThread: async () => {},
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })
        if (method === 'thread/read') return { thread: rootThread }
        if (method === 'thread/list') return { data: [rootThread], nextCursor: null }
        return { turn: { id: 'turn-2', status: 'inProgress', items: [] } }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: rootCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/threads/thread-id/turns',
    payload: {
      projectId: null,
      text: 'Continue at the workspace root',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      collaborationMode: 'plan',
    },
  })

  assert.equal(response.statusCode, 201)
  assert.deepEqual(response.json(), { turnId: 'turn-2' })
  assert.deepEqual(requests.at(-1), {
    method: 'turn/start',
    params: {
      threadId: 'thread-id',
      input: [{ type: 'text', text: 'Continue at the workspace root' }],
      model: 'gpt-5.6-sol',
      effort: 'medium',
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-5.6-sol', reasoning_effort: 'medium' },
      },
    },
  })
  assert.doesNotMatch(response.body, /C:[/\\\\]|items|status/)
})

test('rejects a subsequent Turn for a Thread outside the selected Project', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let startedTurn = false
  const foreignCodex = {
    ...codex,
    ensureThread: async () => {},
    getReady: async () => ({
      request: async (method: string) => {
        if (method === 'turn/start') startedTurn = true
        if (method === 'thread/read') return { thread: { ...thread, cwd: 'C:/outside' } }
        return { data: [], nextCursor: null }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: foreignCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/threads/thread-id/turns',
    payload: {
      projectId: 'project-id',
      text: 'Do not send this',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
    },
  })

  assert.equal(response.statusCode, 404)
  assert.equal(startedTurn, false)
})

test('lists only mapped top-level durable threads with bounded pagination', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let request: { method: string; params?: Record<string, unknown> } | undefined
  const listCodex = {
    ...codex,
    get: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        request = { method, params }
        return {
          data: [
            thread,
            { ...thread, id: 'other', cwd: 'C:/outside/project' },
            { ...thread, id: 'ephemeral', ephemeral: true },
            { ...thread, id: 'child', parentThreadId: 'thread-id' },
          ],
          nextCursor: 'next page / token',
        }
      },
    }),
  }
  listCodex.getReady = listCodex.get as unknown as typeof listCodex.getReady
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: listCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/threads?projectId=project-id&credentialId=credential-id&limit=999&cursor=page%20token',
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    data: [
      {
        id: 'thread-id',
        projectId: 'project-id',
        title: 'Example thread',
        status: 'idle',
        createdAt: 1,
        updatedAt: 2,
        recencyAt: 2,
        modelProvider: 'openai',
      },
    ],
    nextCursor: 'next page / token',
  })
  assert.deepEqual(request, {
    method: 'thread/list',
    params: {
      archived: false,
      cwd: 'C:/test/demo',
      cursor: 'page token',
      limit: 100,
      sortDirection: 'desc',
      sortKey: 'updated_at',
    },
  })
  assert.doesNotMatch(response.body, /C:\/|private|outside/)
})

test('reads a project-owned native thread without resuming it', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let request: { method: string; params?: Record<string, unknown> } | undefined
  const detailCodex = {
    ...codex,
    events: { ...codex.events, latestEventId: () => 12 },
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        request = { method, params }
        return {
          thread: {
            ...thread,
            turns: [
              {
                id: 'turn-1',
                status: 'completed',
                items: [
                  {
                    id: 'user-1',
                    type: 'userMessage',
                    content: [{ type: 'text', text: 'Hi' }],
                  },
                  {
                    id: 'agent-1',
                    type: 'agentMessage',
                    phase: 'final_answer',
                    text: 'Hello',
                  },
                ],
              },
            ],
          },
        }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: detailCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/threads/thread-id?projectId=project-id',
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(request, {
    method: 'thread/read',
    params: { threadId: 'thread-id', includeTurns: true },
  })
  assert.equal(response.json().thread.turns[0].items[1].phase, 'final_answer')
  assert.equal(response.json().eventCursor, 12)
  assert.doesNotMatch(response.body, /C:\/|thread\.jsonl/)
})

test('persists submitted questionnaire answers as a replayable thread event', async (context) => {
  const events = new EventHub()
  const responses: Array<{ requestId: number | string; result: unknown }> = []
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-id' } } }),
    workspace,
    codex: {
      ...codex,
      events,
      respondToServerRequest: (
        _userId: string,
        _threadId: string,
        requestId: number | string,
        result: unknown,
      ) => responses.push({ requestId, result }),
    },
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/threads/thread-id/user-input/42',
    payload: { answers: { choice: { answers: ['First'] } } },
  })
  assert.equal(response.statusCode, 204)
  assert.deepEqual(responses, [
    { requestId: 42, result: { answers: { choice: { answers: ['First'] } } } },
  ])
  assert.deepEqual(await events.threadHistory('user-id', 'thread-id'), [
    {
      id: 1,
      message: {
        method: 'webcodex/userInput/answered',
        params: {
          threadId: 'thread-id',
          requestId: 42,
          answers: { choice: { answers: ['First'] } },
        },
      },
    },
  ])
})

test('returns persisted Thread token usage events for replay', async (context) => {
  const events = new EventHub()
  events.publish('user-id', {
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: 'thread-id',
      turnId: 'turn-1',
      tokenUsage: {
        modelContextWindow: 1000,
        last: { inputTokens: 1, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 3 },
        total: { inputTokens: 10, outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 30 },
      },
    },
  })
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-id' } } }),
    workspace,
    codex: {
      ...codex,
      events,
      getReady: async () => ({ request: async () => ({ thread }) }),
    },
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/threads/thread-id?projectId=project-id',
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.json().historyEvents[0].message.method, 'thread/tokenUsage/updated')
})

test('returns a lightweight owned thread runtime status without reading turns', async (context) => {
  const calls: string[] = []
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-id' } } }),
    workspace,
    codex: {
      ...codex,
      getReady: async () => ({
        request: async (method: string) => {
          calls.push(method)
          return method === 'thread/list' ? { data: [thread], nextCursor: null } : { thread }
        },
      }),
    },
  })
  context.after(() => app.close())
  const response = await app.inject({
    method: 'GET',
    url: '/api/threads/thread-id/status?projectId=project-id',
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    threadId: 'thread-id',
    projectId: 'project-id',
    status: 'idle',
    eventCursor: 0,
    activeTurnId: null,
  })
  assert.deepEqual(calls, ['thread/list'])
})

test('does not report a project-owned thread as a root thread status', async (context) => {
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session: { user: { id: 'user-id' } } }),
    workspace,
    codex,
  })
  context.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/api/threads/thread-id/status' })
  assert.equal(response.statusCode, 404)
  assert.deepEqual(response.json(), {
    error: { code: 'THREAD_NOT_FOUND', message: 'Thread not found' },
  })
})

test('keeps events published during a Thread read after the returned snapshot cursor', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const events = new EventHub()
  let releaseRead!: () => void
  const read = new Promise((resolve) => {
    releaseRead = () => {
      events.publish('user-id', { method: 'turn/started', params: { threadId: 'thread-id' } })
      resolve({ thread })
    }
  })
  const detailCodex = {
    ...codex,
    events,
    getReady: async () => ({
      request: async (method: string) =>
        method === 'thread/read'
          ? read
          : method === 'thread/list'
            ? { data: [thread], nextCursor: null }
            : { thread },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: detailCodex,
  })
  context.after(() => app.close())

  const responsePromise = app.inject({
    method: 'GET',
    url: '/api/threads/thread-id?projectId=project-id',
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  releaseRead()
  const response = await responsePromise
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().eventCursor, 0)
  const replayed: number[] = []
  events.subscribe('user-id', 'thread-id', response.json().eventCursor, (event) =>
    replayed.push(event.id),
  )
  assert.deepEqual(replayed, [1])
})

test('starts after events that already existed before a Thread read', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const events = new EventHub()
  events.publish('user-id', { method: 'turn/started', params: { threadId: 'thread-id' } })
  const detailCodex = {
    ...codex,
    events,
    getReady: async () => ({
      request: async () => ({ thread }),
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: detailCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/threads/thread-id?projectId=project-id',
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().eventCursor, 1)
  const replayed: number[] = []
  events.subscribe('user-id', 'thread-id', response.json().eventCursor, (event) =>
    replayed.push(event.id),
  )
  assert.deepEqual(replayed, [])
})

test('replays an event published after a Thread snapshot returns', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const events = new EventHub()
  const detailCodex = {
    ...codex,
    events,
    getReady: async () => ({
      request: async () => ({ thread }),
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: detailCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/threads/thread-id?projectId=project-id',
  })
  assert.equal(response.statusCode, 200)
  const eventCursor = response.json().eventCursor
  events.publish('user-id', { method: 'turn/completed', params: { threadId: 'thread-id' } })
  const replayed: number[] = []
  events.subscribe('user-id', 'thread-id', eventCursor, (event) => replayed.push(event.id))
  assert.deepEqual(replayed, [eventCursor + 1])
})

test('lists unbound threads throughout the user workspace without a Project record', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let request: { method: string; params?: Record<string, unknown> } | undefined
  const rootThread = { ...thread, cwd: 'C:/test/removed-project' }
  const rootCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        request = { method, params }
        return { data: [rootThread, thread], nextCursor: null }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: rootCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/threads?limit=100',
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().data.length, 1)
  assert.equal(response.json().data[0].projectId, null)
  assert.deepEqual(request, {
    method: 'thread/list',
    params: {
      archived: false,
      limit: 100,
      sortDirection: 'desc',
      sortKey: 'updated_at',
    },
  })
})

test('reads a root thread at the user workspace root', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const rootThread = { ...thread, cwd: 'C:/test' }
  const rootCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string) =>
        method === 'thread/list'
          ? { data: [rootThread], nextCursor: null }
          : { thread: rootThread },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: rootCodex,
  })
  context.after(() => app.close())
  const response = await app.inject({
    method: 'GET',
    url: '/api/threads/thread-id',
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().thread.id, 'thread-id')
})

test('archives an owned thread through the App Server archive request', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const archiveCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })
        return method === 'thread/list' ? { data: [thread], nextCursor: null } : {}
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: archiveCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/api/threads/thread-id/archive?projectId=project-id',
  })
  assert.equal(response.statusCode, 204)
  assert.deepEqual(requests, [
    {
      method: 'thread/list',
      params: {
        archived: false,
        cwd: 'C:/test/demo',
        limit: 100,
        sortDirection: 'desc',
        sortKey: 'updated_at',
      },
    },
    { method: 'thread/archive', params: { threadId: 'thread-id' } },
  ])
})

test('lists archived chats across project and root workspace scopes', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const archivedCodex = {
    ...codex,
    getReady: async () => ({
      request: async () => ({
        data: [thread, { ...thread, id: 'root-thread', cwd: 'C:/test' }],
        nextCursor: null,
      }),
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: archivedCodex,
  })
  context.after(() => app.close())
  const response = await app.inject({ method: 'GET', url: '/api/threads?archived=true' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(
    response
      .json()
      .data.map((item: { id: string; projectId: string | null }) => [item.id, item.projectId]),
    [
      ['thread-id', 'project-id'],
      ['root-thread', null],
    ],
  )
})

test('unarchives and deletes only owned archived chats', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const archivedCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })
        return method === 'thread/list' ? { data: [thread], nextCursor: null } : {}
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: archivedCodex,
  })
  context.after(() => app.close())
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-id/unarchive?projectId=project-id',
      })
    ).statusCode,
    204,
  )
  assert.equal(
    (await app.inject({ method: 'DELETE', url: '/api/threads/thread-id?projectId=project-id' }))
      .statusCode,
    204,
  )
  assert.ok(requests.some((request) => request.method === 'thread/unarchive'))
  assert.ok(requests.some((request) => request.method === 'thread/delete'))
  assert.ok(
    requests
      .filter((request) => request.method === 'thread/list')
      .every((request) => request.params?.archived === true),
  )
})

test('delete all skips archived chats outside the controlled user root', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const deleted: string[] = []
  const archivedCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'thread/delete') {
          deleted.push(String(params?.threadId))
          return {}
        }
        return { data: [thread, { ...thread, id: 'foreign', cwd: 'D:/foreign' }], nextCursor: null }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: archivedCodex,
  })
  context.after(() => app.close())
  assert.equal(
    (await app.inject({ method: 'DELETE', url: '/api/threads?archived=true' })).statusCode,
    204,
  )
  assert.deepEqual(deleted, ['thread-id'])
})

test('rejects invalid thread resources before starting Codex', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let started = false
  const missingWorkspace = { ...workspace, getProject: async () => undefined }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace: missingWorkspace as unknown as typeof workspace,
    codex: {
      ...codex,
      get: async () => {
        started = true
        return codex.get()
      },
    },
  })
  context.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/api/threads?projectId=missing&credentialId=credential-id',
  })
  assert.equal(response.statusCode, 404)
  assert.deepEqual(response.json(), {
    error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found' },
  })
  assert.equal(started, false)
})

test('lists safe enabled Skills for a Project without exposing local paths', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let request: { method: string; params?: Record<string, unknown> } | undefined
  const skillsCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        request = { method, params }
        return {
          data: [
            {
              cwd: 'C:/test/demo',
              errors: [{ path: 'C:/private/broken/SKILL.md', message: 'broken' }],
              skills: [
                {
                  name: 'pdf',
                  description: 'Create PDFs',
                  enabled: true,
                  path: 'C:/private/skills/pdf/SKILL.md',
                  scope: 'user',
                  shortDescription: 'Create PDFs',
                  interface: { displayName: 'PDF tools', shortDescription: 'Work with PDF files' },
                },
                {
                  name: 'pdf',
                  description: 'Repository PDF workflow',
                  enabled: true,
                  path: 'C:/test/demo/.agents/skills/pdf/SKILL.md',
                  scope: 'repo',
                  shortDescription: null,
                  interface: null,
                },
                {
                  name: 'disabled',
                  description: 'Hidden',
                  enabled: false,
                  path: 'C:/private/skills/disabled/SKILL.md',
                  scope: 'user',
                  shortDescription: null,
                  interface: null,
                },
              ],
            },
          ],
        }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: skillsCodex,
  })
  context.after(() => app.close())

  const response = await app.inject({ method: 'GET', url: '/api/skills?projectId=project-id' })

  assert.equal(response.statusCode, 200)
  const body = response.json() as {
    data: Array<{
      handle: string
      name: string
      displayName: string
      description: string
      scope: string
    }>
  }
  assert.equal(body.data.length, 2)
  assert.deepEqual(
    body.data.map(({ name, displayName, description, scope }) => ({
      name,
      displayName,
      description,
      scope,
    })),
    [
      { name: 'pdf', displayName: 'PDF tools', description: 'Work with PDF files', scope: 'user' },
      { name: 'pdf', displayName: 'pdf', description: 'Repository PDF workflow', scope: 'repo' },
    ],
  )
  assert.ok(body.data.every((skill) => /^[0-9a-f-]{36}$/i.test(skill.handle)))
  assert.deepEqual(request, { method: 'skills/list', params: { cwds: ['C:/test/demo'] } })
  assert.doesNotMatch(response.body, /C:[/\\]|broken|SKILL\.md/)
})

test('adds validated selected Skills to a new Turn in selection order', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const available = [
    {
      name: 'pdf',
      description: 'Create PDFs',
      enabled: true,
      path: 'C:/private/skills/pdf/SKILL.md',
      scope: 'user',
      shortDescription: null,
      interface: null,
    },
    {
      name: 'research',
      description: 'Research a topic',
      enabled: true,
      path: 'C:/private/skills/research/SKILL.md',
      scope: 'user',
      shortDescription: null,
      interface: null,
    },
  ]
  const skillsCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })
        if (method === 'skills/list')
          return { data: [{ cwd: 'C:/test/demo', errors: [], skills: available }] }
        if (method === 'thread/start') return { thread }
        return { turn: { id: 'turn-2', status: 'inProgress', items: [] } }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: skillsCodex,
  })
  context.after(() => app.close())

  const listed = await app.inject({ method: 'GET', url: '/api/skills?projectId=project-id' })
  const handles = listed.json().data.map((skill) => skill.handle)
  const response = await app.inject({
    method: 'POST',
    url: '/api/threads',
    payload: {
      projectId: 'project-id',
      text: 'Summarize the policy.',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      skillHandles: handles,
    },
  })

  assert.equal(response.statusCode, 201)
  assert.deepEqual(requests.at(-1), {
    method: 'turn/start',
    params: {
      threadId: 'thread-id',
      input: [
        { type: 'text', text: '$pdf $research\nSummarize the policy.' },
        { type: 'skill', name: 'pdf', path: 'C:/private/skills/pdf/SKILL.md' },
        { type: 'skill', name: 'research', path: 'C:/private/skills/research/SKILL.md' },
      ],
      effort: 'medium',
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-5.6-sol', reasoning_effort: 'medium' },
      },
    },
  })
})

test('adds validated selected Skills to an owned existing Turn', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const skillsCodex = {
    ...codex,
    ensureThread: async () => {},
    getReady: async () => ({
      request: async (method: string, params?: Record<string, unknown>) => {
        requests.push({ method, params })
        if (method === 'skills/list')
          return {
            data: [
              {
                cwd: 'C:/test/demo',
                errors: [],
                skills: [
                  {
                    name: 'pdf',
                    description: 'Create PDFs',
                    enabled: true,
                    path: 'C:/private/skills/pdf/SKILL.md',
                    scope: 'user',
                    shortDescription: null,
                    interface: null,
                  },
                ],
              },
            ],
          }
        if (method === 'thread/read') return { thread }
        if (method === 'thread/list') return { data: [thread], nextCursor: null }
        return { turn: { id: 'turn-2', status: 'inProgress', items: [] } }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: skillsCodex,
  })
  context.after(() => app.close())

  const listed = await app.inject({ method: 'GET', url: '/api/skills?projectId=project-id' })
  const handle = listed.json().data[0]?.handle
  const response = await app.inject({
    method: 'POST',
    url: '/api/threads/thread-id/turns',
    payload: {
      projectId: 'project-id',
      text: 'Summarize the policy.',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      skillHandles: [handle],
    },
  })

  assert.equal(response.statusCode, 201)
  assert.deepEqual(requests.at(-1), {
    method: 'turn/start',
    params: {
      threadId: 'thread-id',
      input: [
        { type: 'text', text: '$pdf\nSummarize the policy.' },
        { type: 'skill', name: 'pdf', path: 'C:/private/skills/pdf/SKILL.md' },
      ],
      model: 'gpt-5.6-sol',
      effort: 'medium',
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'gpt-5.6-sol', reasoning_effort: 'medium' },
      },
    },
  })
})

test('rejects stale selected Skills before creating a Thread', async (context) => {
  const session = {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'user@example.com' },
  }
  let listCalls = 0
  let startedThread = false
  const skillsCodex = {
    ...codex,
    getReady: async () => ({
      request: async (method: string) => {
        if (method === 'skills/list') {
          listCalls += 1
          return {
            data: [
              {
                cwd: 'C:/test',
                errors: [],
                skills:
                  listCalls === 1
                    ? [
                        {
                          name: 'pdf',
                          description: 'Create PDFs',
                          enabled: true,
                          path: 'C:/private/skills/pdf/SKILL.md',
                          scope: 'user',
                          shortDescription: null,
                          interface: null,
                        },
                      ]
                    : [],
              },
            ],
          }
        }
        if (method === 'thread/start') startedThread = true
        return { thread }
      },
    }),
  }
  const app = await buildOwnerServer(config, {
    auth: fakeAuth({ session }),
    workspace,
    codex: skillsCodex,
  })
  context.after(() => app.close())

  const listed = await app.inject({ method: 'GET', url: '/api/skills' })
  const handle = listed.json().data[0]?.handle
  const response = await app.inject({
    method: 'POST',
    url: '/api/threads',
    payload: {
      projectId: null,
      text: 'Create a report.',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      skillHandles: [handle],
    },
  })

  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.json(), {
    error: { code: 'INVALID_SKILL_SELECTION', message: 'Selected skills are no longer available' },
  })
  assert.equal(startedThread, false)
})
