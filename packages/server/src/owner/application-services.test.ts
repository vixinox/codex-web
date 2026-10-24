import assert from 'node:assert/strict'
import test from 'node:test'

import { createOwnerApplicationServices } from './application-services.js'
import type { OwnerMethodContext, OwnerTransport } from './session-runtime.js'

function context(
  transport: Partial<OwnerTransport> = {},
  owner?: OwnerMethodContext['owner'],
): OwnerMethodContext {
  return {
    owner: owner ?? null,
    transport: {
      kind: 'local',
      origin: 'http://localhost:5173',
      send: () => undefined,
      close: () => undefined,
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
      ...transport,
    },
    signal: new AbortController().signal,
    authenticate: () => undefined,
  }
}

function dependencies() {
  const workspace = {
    hasOwner: async () => true,
    listCredentials: async () => [
      {
        id: 'credential-1',
        provider: 'example.proxy',
        baseUrl: 'https://api.example.com',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
    getCurrentCredentialId: async () => 'credential-1',
    setCurrentCredentialId: async () => true,
    getCredential: async () => ({
      id: 'credential-1',
      provider: 'example.proxy',
      baseUrl: 'https://api.example.com',
      encryptedApiKey: 'encrypted',
      apiKey: 'secret',
    }),
    saveCredential: async () => ({
      id: 'credential-2',
      provider: 'example.proxy',
      baseUrl: 'https://api.example.com',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    testCredential: async () => true,
    deleteCredential: async () => true,
    listProjects: async () => [
      {
        id: 'project-1',
        name: 'workspace',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
    createProject: async () => ({
      id: 'project-2',
      name: 'new-project',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    renameProject: async () => ({
      id: 'project-1',
      name: 'renamed',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    deleteProject: async () => true,
  }
  return {
    workspace,
    auth: { api: {} },
    codex: {
      getStatus: () => ({
        status: 'ready',
        projectId: null,
        activeCredentialId: 'credential-1',
        pendingCredentialId: null,
        restartRequired: false,
        activeTurns: 0,
        error: null,
      }),
    },
  } as never
}

test('projects and credentials services require Owner context and return safe projections', async () => {
  const services = createOwnerApplicationServices(dependencies(), {
    trustedOrigins: ['http://localhost:5173'],
  })
  const owner = {
    ownerId: 'owner-1',
    sessionId: 'session-1',
    sessionToken: 'opaque-token',
    clientId: 'client-1',
    connectionId: 'connection-1',
    transport: { kind: 'local' as const },
  }

  await assert.rejects(() => services.credentialsList(context()), /UNAUTHORIZED/)
  const credentials = await services.credentialsList(context({}, owner))
  assert.deepEqual(credentials.currentCredentialId, 'credential-1')
  assert.equal(JSON.stringify(credentials).includes('secret'), false)
  const projects = await services.projectsList(context({}, owner))
  assert.deepEqual(
    projects.projects.map((project) => project.id),
    ['project-1'],
  )
  const status = await services.codexStatus(context({}, owner))
  assert.deepEqual(status.error, null)
  assert.equal(JSON.stringify(status).includes('secret'), false)
})

test('bootstrap is local-origin restricted and serializes the owner-exists check', async () => {
  let ownerExists = false
  const fakeAuth = {
    api: {
      signUpEmail: async () => {
        ownerExists = true
        const response = new Response('{}', { status: 200 })
        response.headers.set('set-auth-token', 'opaque-token')
        return response
      },
      getSession: async () => ({
        user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
        session: { id: 'session-1', expiresAt: new Date('2030-01-01T00:00:00Z') },
      }),
    },
  }
  const deps = dependencies() as {
    workspace: { hasOwner: () => Promise<boolean> }
    auth: typeof fakeAuth
    codex: unknown
  }
  deps.workspace.hasOwner = async () => ownerExists
  deps.auth = fakeAuth
  const services = createOwnerApplicationServices(deps as never, {
    trustedOrigins: ['http://localhost:5173'],
  })
  const first = await services.bootstrapCreate(context(), {
    name: 'Owner',
    email: 'owner@example.com',
    password: 'password-123456',
  })
  assert.equal(first.token, 'opaque-token')
  await assert.rejects(
    () =>
      services.bootstrapCreate(context(), {
        name: 'Owner',
        email: 'owner@example.com',
        password: 'password-123456',
      }),
    /OWNER_ALREADY_EXISTS/,
  )
  await assert.rejects(
    () =>
      services.bootstrapCreate(context({ origin: 'http://attacker.example' }), {
        name: 'Owner',
        email: 'owner@example.com',
        password: 'password-123456',
      }),
    /LOCAL_TRANSPORT_REQUIRED/,
  )
})

test('opens bearer sessions, resumes them, closes them, and rejects failed credentials', async () => {
  let signedOut = false
  const fakeAuth = {
    api: {
      signInEmail: async ({ body }: { body: { password: string } }) => {
        if (body.password !== 'correct-password') return new Response('{}', { status: 401 })
        const response = new Response('{}', { status: 200 })
        response.headers.set('set-auth-token', 'opaque-token')
        return response
      },
      getSession: async ({ headers }: { headers: Headers }) =>
        headers.get('authorization') === 'Bearer opaque-token'
          ? {
              user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' },
              session: { id: 'session-1', expiresAt: new Date('2030-01-01T00:00:00Z') },
            }
          : null,
      signOut: async ({ headers }: { headers: Headers }) => {
        signedOut = headers.get('authorization') === 'Bearer opaque-token'
        return { success: signedOut }
      },
    },
  }
  const deps = dependencies() as {
    workspace: unknown
    auth: typeof fakeAuth
    codex: unknown
  }
  deps.auth = fakeAuth
  const services = createOwnerApplicationServices(deps as never, {
    trustedOrigins: ['http://localhost:5173'],
  })
  await assert.rejects(
    () => services.sessionOpen({ email: 'owner@example.com', password: 'bad-password' }),
    /AUTH_FAILURE/,
  )
  const opened = await services.sessionOpen({
    email: 'owner@example.com',
    password: 'correct-password',
  })
  assert.equal(opened.token, 'opaque-token')
  assert.equal(opened.admission.sessionId, 'session-1')
  const resumed = await services.resumeSession('opaque-token', context().transport)
  assert.equal(resumed?.ownerId, 'owner-1')
  assert.equal(await services.resumeSession('invalid-token', context().transport), null)
  await services.sessionClose(
    context(
      {},
      {
        ownerId: 'owner-1',
        sessionId: 'session-1',
        sessionToken: 'opaque-token',
        clientId: 'client-1',
        connectionId: 'connection-1',
        transport: { kind: 'local' },
      },
    ),
  )
  assert.equal(signedOut, true)
})

test('remote application methods require local authenticated context and use the connector', async () => {
  const deps = {
    ...dependencies(),
    remote: {
      isConnected: () => true,
      trust: { status: async () => ({ nodeId: 'node-1', pairedClients: 1 }) },
      createPairingOffer: async (relayUrl?: string) => ({ relayUrl: relayUrl ?? 'wss://relay' }),
      resetRemoteTrust: async () => ({ trustEpoch: 2 }),
      listDevices: async () => [{ id: 'device-1', createdAt: '2026-01-01', lastSeenAt: null }],
      revokeDevice: async (id: string) => id === 'device-1',
    },
  }
  const services = createOwnerApplicationServices(deps as never, {
    trustedOrigins: ['http://localhost:5173'],
    remoteRelayUrl: 'wss://relay',
  })
  const owner = {
    ownerId: 'owner-1',
    sessionId: 'session-1',
    clientId: 'client-1',
    connectionId: 'connection-1',
    transport: { kind: 'local' as const },
  }
  assert.deepEqual(await services.remoteStatus(context({}, owner)), {
    configured: true,
    connected: true,
    relayUrl: 'wss://relay',
    nodeId: 'node-1',
    pairedClients: 1,
  })
  assert.deepEqual(
    await services.remotePairingOffer(context({}, owner), { relayUrl: 'wss://relay-alt' }),
    { relayUrl: 'wss://relay-alt' },
  )
  assert.deepEqual(await services.remoteTrustReset(context({}, owner)), { trustEpoch: 2 })
  assert.deepEqual(await services.remoteDevices(context({}, owner)), [
    { id: 'device-1', createdAt: '2026-01-01', lastSeenAt: null },
  ])
  assert.deepEqual(
    await services.remoteDeviceRevoke(context({}, owner), { deviceId: 'device-1' }),
    {
      revoked: true,
    },
  )
  await assert.rejects(
    () =>
      services.remoteTrustReset(
        context({ kind: 'relay' }, { ...owner, transport: { kind: 'relay' } }),
      ),
    /LOCAL_TRANSPORT_REQUIRED/,
  )
})

test('events expose owner-scoped cursors and require the originating session to resume', async () => {
  const handlers = new Set<(...args: unknown[]) => void>()
  const subscriptionContext = context(
    {},
    {
      ownerId: 'owner-1',
      sessionId: 'session-1',
      clientId: 'client-1',
      connectionId: 'connection-1',
      transport: { kind: 'local' },
    },
  )
  const deps = dependencies() as {
    workspace: unknown
    auth: unknown
    codex: { events: Record<string, unknown> }
  }
  deps.codex.events = {
    latestEventId: () => 4,
    subscribe: (
      _ownerId: string,
      _threadId: string | undefined,
      _afterId: number,
      listener: (...args: unknown[]) => void,
    ) => {
      handlers.add(listener)
      return () => handlers.delete(listener)
    },
  }
  const services = createOwnerApplicationServices(deps as never, {
    trustedOrigins: ['http://localhost:5173'],
  })
  const subscribed = await services.eventsSubscribe(subscriptionContext, {
    scope: 'workspace',
  })
  const cursor = subscribed.result.cursor as { epoch: string; sequence: number }
  const subscriptionId = subscribed.result.subscriptionId as string
  assert.equal(cursor.sequence, 4)
  assert.match(cursor.epoch, /^[A-Za-z0-9_-]+$/)

  const resumed = await services.eventsResume(subscriptionContext, { subscriptionId, cursor })
  assert.equal(resumed.result.subscriptionId, subscriptionId)
  await assert.rejects(
    () =>
      services.eventsResume(
        context(
          {},
          {
            ownerId: 'owner-1',
            sessionId: 'session-2',
            clientId: 'client-2',
            connectionId: 'connection-2',
            transport: { kind: 'local' },
          },
        ),
        { subscriptionId, cursor },
      ),
    /SUBSCRIPTION_EXPIRED/,
  )
})

test('events subscribe with a replay cursor, reset stale history, and reject foreign epochs', async () => {
  const owner = {
    ownerId: 'owner-1',
    sessionId: 'session-1',
    clientId: 'client-1',
    connectionId: 'connection-1',
    transport: { kind: 'local' as const },
  }
  const deps = dependencies() as {
    workspace: unknown
    auth: unknown
    codex: { events: Record<string, unknown> }
  }
  deps.codex.events = {
    latestEventId: () => 10,
    isCursorExpired: async (_ownerId: string, _threadId: string | undefined, sequence: number) =>
      sequence < 5,
    subscribe: () => () => undefined,
  }
  const services = createOwnerApplicationServices(deps as never, {
    trustedOrigins: ['http://localhost:5173'],
  })
  const baseline = await services.eventsSubscribe(context({}, owner), { scope: 'workspace' })
  const epoch = (baseline.result.cursor as { epoch: string }).epoch
  await assert.rejects(
    () =>
      services.eventsSubscribe(context({}, owner), {
        scope: 'workspace',
        cursor: { epoch: 'foreign-owner', sequence: 9 },
      }),
    /INVALID_EVENT_CURSOR/,
  )
  const stale = await services.eventsSubscribe(context({}, owner), {
    scope: 'workspace',
    cursor: { epoch, sequence: 2 },
  })
  const emitted: unknown[] = []
  const controller = new AbortController()
  await (
    stale.stream.run as (
      emit: (value: unknown) => Promise<void>,
      signal: AbortSignal,
    ) => Promise<void>
  )(async (value) => {
    emitted.push(value)
  }, controller.signal)
  assert.deepEqual(emitted, [
    {
      method: 'events.reset',
      params: {
        cursor: { epoch, sequence: 10 },
        reason: 'cursor_gap',
      },
    },
  ])
})
