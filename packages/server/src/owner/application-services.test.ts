import { CodexRpcRequestError } from '../codex/rpc-client.js'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDomainEvent } from '../codex/domain-events.js'
import { EventHub } from '../codex/event-hub.js'
import type { ConversationId, EventIdentity, InteractionId, TurnId } from '@codex-web/conversation'
import { applyChange, createConversationState } from '@codex-web/conversation'
import { createDatabase, prepareOwnerDatabase } from '../database.js'
import type { ServerConfig } from '../config.js'
import { owner } from '../db/schema.js'
import { isConversationChange, parseOwnerStreamEvent } from '@codex-web/protocol/owner'
import { createOwnerApplicationServices } from './application-services.js'
import { createOwnerMethodRegistry } from './methods.js'
import {
  OwnerMethodError,
  type OwnerMethodContext,
  type OwnerTransport,
} from './session-runtime.js'

function testConfig(dataRoot: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    trustedOrigins: ['http://localhost:5173'],
    dataRoot,
    maxActiveTasksPerUser: 2,
    credentialEncryptionKey: 'test-key',
    allowedOutboundSchemes: ['https'],
    allowedOutboundHosts: ['api.example.com'],
  }
}

test('streams a domain event envelope through Owner WS events.subscribe', async () => {
  const event = {
    ...createDomainEvent('codex.thread/closed', { threadId: 'thread-a' }, { threadId: 'thread-a' }),
    eventId: 1,
  }
  const services = createOwnerApplicationServices(
    {
      workspace: { getOnlyOwnerId: async () => 'owner-a' } as never,
      codex: {
        events: {
          latestEventId: () => 0,
          isCursorExpired: async () => false,
          subscribeFrom: async (
            _ownerId: string,
            _threadId: string | undefined,
            _afterId: number,
            listener: (stored: { id: number; message: typeof event }) => void,
          ) => {
            listener({ id: event.eventId, message: event })
            return () => undefined
          },
        },
      } as never,
    },
    { trustedOrigins: [] },
  )
  const transport: OwnerTransport = {
    kind: 'local',
    send: () => undefined,
    close: () => undefined,
    onMessage: () => () => undefined,
    onClose: () => () => undefined,
  }
  const context = {
    owner: {
      ownerId: 'owner-a',
      sessionId: 'session-a',
      clientId: 'client-a',
      connectionId: 'connection-a',
      transport: { kind: 'local' },
    },
    connectionId: 'connection-a',
    transport,
    signal: new AbortController().signal,
    requestId: 'request-a',
    authenticate: () => undefined,
    unauthenticate: () => undefined,
  } as OwnerMethodContext
  const result = await services.eventsSubscribe(context, { scope: 'workspace' })
  assert.ok('stream' in result)
  const streamed: unknown[] = []
  const abort = new AbortController()
  const running = result.stream.run(async (value) => streamed.push(value), abort.signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  abort.abort()
  await running

  assert.equal(streamed.length, 1)
  assert.deepEqual((streamed[0] as { event: unknown }).event, event)
  assert.equal((streamed[0] as { cursor: { sequence: number } }).cursor.sequence, event.eventId)
  assert.equal(parseOwnerStreamEvent(streamed[0]).ok, true)
  const meta = result.stream.meta as {
    subscriptionId: string
    cursor: { epoch: string; sequence: number }
  }
  for (const cursor of [
    { epoch: 'previous-process', sequence: 0 },
    { epoch: meta.cursor.epoch, sequence: 100 },
  ]) {
    const reset = await services.eventsSubscribe(context, { scope: 'workspace', cursor })
    assert.ok('stream' in reset)
    const messages: unknown[] = []
    await reset.stream.run(async (value) => {
      messages.push(value)
    }, new AbortController().signal)
    assert.deepEqual(messages, [
      {
        method: 'events.reset',
        params: {
          cursor: meta.cursor,
          reason: cursor.epoch === meta.cursor.epoch ? 'cursor_gap' : 'epoch_changed',
        },
      },
    ])
  }
  const resumed = await services.eventsResume(context, {
    subscriptionId: meta.subscriptionId,
    cursor: meta.cursor,
  })
  assert.ok('stream' in resumed)
  const resumedEvents: unknown[] = []
  const resumeAbort = new AbortController()
  const resumedRun = resumed.stream.run(async (value) => {
    resumedEvents.push(value)
  }, resumeAbort.signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  resumeAbort.abort()
  await resumedRun
  assert.deepEqual(resumedEvents, streamed)
})

test('reconciles materialized messages, buffered deltas, and interactions at the read cut', async () => {
  const { adaptCodexNotification } = await import('../codex/conversation-adapter.js')
  const ownerId = 'owner-conversation-cut'
  const threadId = 'thread-cut' as ConversationId
  const turnId = 'turn-cut' as TurnId
  const interactionId = 'interaction-cut' as InteractionId
  const projectId = 'project-cut'
  const userRoot = path.join(tmpdir(), 'codex-owner-conversation-cut')
  const cwd = path.join(userRoot, 'project')
  const events = new EventHub()
  const identity = (eventId: string): EventIdentity => ({
    sourceId: 'test-adapter' as EventIdentity['sourceId'],
    sourceEventId: eventId as EventIdentity['sourceEventId'],
    receivedAt: '2026-01-01T00:00:00.000Z',
  })
  let requested = false
  const publishDelta = async (itemId: string, delta: string, eventId: string) => {
    const changes = adaptCodexNotification(
      'item/agentMessage/delta',
      { threadId, turnId, itemId, delta },
      identity(eventId),
    )
    for (const [index, change] of changes.entries()) {
      await events.publishConversationChange(ownerId, threadId, {
        ...change,
        identity: identity(`${eventId}:${index}`),
      })
    }
  }
  const services = createOwnerApplicationServices(
    {
      workspace: {
        getOnlyOwnerId: async () => ownerId,
        getUserRoot: () => userRoot,
        getProject: async () => ({ id: projectId, path: cwd }),
        listProjectLocations: async () => [{ id: projectId, path: cwd }],
      } as never,
      codex: {
        events,
        getReady: async () => ({
          request: async (
            method: string,
            _params?: Record<string, unknown>,
            _signal?: AbortSignal,
            onResponse?: () => void,
          ) => {
            assert.equal(method, 'thread/read')
            if (!requested) {
              requested = true
              await events.publishConversationChange(ownerId, threadId, {
                type: 'interaction.opened',
                identity: identity('opening'),
                interaction: { id: interactionId, turnId, kind: 'approval', status: 'pending' },
              })
              await publishDelta('unfinished', 'before ', 'before-cut')
              await publishDelta('materialized', 'already saved', 'already-saved')
              await publishDelta('active-materialized', 'token=synthetic', 'active-saved')
              await publishDelta('empty-materialized', 'fallback', 'empty-saved')
            }
            assert.ok(onResponse)
            onResponse()
            await publishDelta('unfinished', 'after ', 'after-cut')
            await events.publishConversationChange(ownerId, threadId, {
              type: 'interaction.resolved',
              identity: identity('resolution'),
              interactionId,
              outcome: { kind: 'approved' },
            })
            return {
              thread: {
                id: threadId,
                cwd,
                turns: [
                  {
                    id: turnId,
                    status: 'inProgress',
                    items: [
                      { id: 'materialized', type: 'agentMessage', text: 'already saved' },
                      {
                        id: 'active-materialized',
                        type: 'agentMessage',
                        status: 'inProgress',
                        text: 'token=synthetic',
                      },
                      {
                        id: 'empty-materialized',
                        type: 'agentMessage',
                        status: 'inProgress',
                        text: '',
                      },
                    ],
                  },
                ],
              },
            }
          },
        }),
      } as never,
    },
    { trustedOrigins: [] },
  )
  const context = { owner: { ownerId } } as OwnerMethodContext
  const { snapshot, watermark } = await services.threadsRead(context, { threadId, projectId })
  assert.equal(snapshot.watermark, watermark.sequence)
  assert.equal(snapshot.interactions[interactionId]?.status, 'pending')
  assert.deepEqual(
    Object.values(snapshot.messages).map(({ id, parts }) => [id, parts[0]]),
    [
      ['materialized', { id: 'materialized:text:0', type: 'text', text: 'already saved' }],
      [
        'active-materialized',
        { id: 'active-materialized:text:0', type: 'text', text: 'token=synthetic' },
      ],
      ['empty-materialized', { id: 'empty-materialized:text:0', type: 'text', text: 'fallback' }],
      ['unfinished', { id: 'unfinished:text:0', type: 'text', text: 'before ' }],
    ],
  )

  let resumed = createConversationState(snapshot)
  const unsubscribe = await events.subscribeFrom(ownerId, threadId, watermark.sequence, (event) => {
    const change = event.message.payload.change
    assert.ok(isConversationChange(change))
    resumed = applyChange(resumed, change)
  })
  unsubscribe()
  assert.equal(resumed.interactions[interactionId]?.status, 'resolved')
  assert.deepEqual(
    Object.values(resumed.messages).map(({ parts }) => parts[0]),
    [
      { id: 'materialized:text:0', type: 'text', text: 'already saved' },
      { id: 'active-materialized:text:0', type: 'text', text: 'token=synthetic' },
      { id: 'empty-materialized:text:0', type: 'text', text: 'fallback' },
      { id: 'unfinished:text:0', type: 'text', text: 'before after ' },
    ],
  )
})

test('typed Conversation commands require Owner and thread authorization before mutation', async () => {
  const root = path.join(tmpdir(), 'codex-command-owner')
  const mutations: unknown[] = []
  const services = createOwnerApplicationServices(
    {
      workspace: {
        getOnlyOwnerId: async () => 'owner-commands',
        getUserRoot: () => root,
        listProjectLocations: async () => [],
        getProject: async () => null,
      } as never,
      codex: {
        getReady: async () => ({
          request: async (method: string, params: Record<string, unknown>) => {
            if (method === 'thread/read') return { thread: { id: params.threadId, cwd: root } }
            if (method === 'thread/list') return { data: [{ id: 'owned', cwd: root }] }
            mutations.push([method, params])
            if (method === 'turn/steer') {
              if (params.expectedTurnId === 'rejected')
                throw new CodexRpcRequestError('Not steerable')
              if (params.expectedTurnId === 'disconnected') throw new Error('Disconnected')
              if (params.expectedTurnId === 'invalid-response') return { turnId: 'other' }
              return { turnId: params.expectedTurnId }
            }
            return { turn: { id: 'turn-1' } }
          },
        }),
        cancelQueuedTurn: (...args: unknown[]) => {
          mutations.push(args)
          return false
        },
        respondToServerRequest: (...args: unknown[]) => {
          mutations.push(args)
        },
        events: {},
      } as never,
    },
    { trustedOrigins: [] },
  )
  const method = createOwnerMethodRegistry(services).get('conversation.command')
  assert.equal(method?.access, 'authenticated')
  assert.ok(method)
  const context = { owner: { ownerId: 'owner-commands' } } as OwnerMethodContext
  const send = async (params: unknown, requestContext = context) =>
    method.handle(params, requestContext)
  const start = {
    type: 'turn.start',
    conversationId: 'owned',
    input: [{ type: 'text', id: 'part-1', text: '  Synthetic prompt  ' }],
    projectId: null,
    model: 'test-model',
    reasoningEffort: 'medium',
    collaborationMode: 'default',
    skills: [],
  }
  await assert.rejects(send(start, { ...context, owner: null }), {
    code: 'owner.auth.unauthorized',
  })
  await assert.rejects(send({ ...start, projectId: 'missing' }), {
    code: new OwnerMethodError('PROJECT_NOT_FOUND').code,
  })
  const forbidden = { conversationId: 'outside' }
  const notFound = { code: new OwnerMethodError('THREAD_NOT_FOUND').code }
  await assert.rejects(send({ ...start, ...forbidden }), notFound)
  await assert.rejects(send({ ...forbidden, type: 'turn.cancel', turnId: 'turn-1' }), {
    ...notFound,
  })
  await assert.rejects(send({ ...forbidden, type: 'conversation.archive' }), {
    ...notFound,
  })
  await assert.rejects(send({ ...forbidden, type: 'conversation.compact' }), notFound)
  await assert.rejects(
    send({ conversationId: 'owned', type: 'conversation.compact' }, { ...context, owner: null }),
    { code: 'owner.auth.unauthorized' },
  )
  await assert.rejects(
    send({
      ...forbidden,
      type: 'interaction.respond',
      interactionId: 'request:1',
      outcome: { kind: 'approved' },
    }),
    notFound,
  )
  assert.deepEqual(mutations, [])

  assert.deepEqual(await send(start), { turnId: 'turn-1' })
  assert.deepEqual(mutations, [
    [
      'turn/start',
      {
        threadId: 'owned',
        input: [{ type: 'text', text: 'Synthetic prompt' }],
        model: 'test-model',
        effort: 'medium',
        collaborationMode: {
          mode: 'default',
          settings: { model: 'test-model', reasoning_effort: 'medium' },
        },
      },
    ],
  ])
  assert.deepEqual(await send({ type: 'conversation.compact', conversationId: 'owned' }), {
    accepted: true,
  })
  assert.deepEqual(mutations.at(-1), ['thread/compact/start', { threadId: 'owned' }])
  const steer = {
    type: 'turn.steer',
    conversationId: 'owned',
    expectedTurnId: 'turn-1',
    input: [{ type: 'text', id: 'p', text: 'Continue differently' }],
    skills: [],
  }
  await assert.rejects(send(steer, { ...context, owner: null }), {
    code: 'owner.auth.unauthorized',
  })
  await assert.rejects(send({ ...steer, ...forbidden }), notFound)
  await assert.rejects(send({ ...steer, expectedTurnId: '' }), {
    code: 'owner.turn.invalid-request',
  })
  await assert.rejects(send({ ...steer, expectedTurnId: 'rejected' }), {
    code: 'owner.turn.invalid-request',
    retryable: false,
  })
  await assert.rejects(send({ ...steer, expectedTurnId: 'disconnected' }), {
    code: 'owner.runtime.unavailable',
    retryable: false,
  })
  await assert.rejects(send({ ...steer, expectedTurnId: 'invalid-response' }), {
    code: 'owner.runtime.invalid-response',
  })
  assert.deepEqual(await send(steer), { turnId: 'turn-1' })
  assert.deepEqual(mutations.at(-1), [
    'turn/steer',
    {
      threadId: 'owned',
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'Continue differently' }],
    },
  ])
})

test('lists root threads when the caller sends an explicit null project scope', async () => {
  const userRoot = path.join(tmpdir(), 'codex-owner-root-threads')
  const services = createOwnerApplicationServices(
    {
      workspace: {
        getOnlyOwnerId: async () => 'owner-root-threads',
        getUserRoot: () => userRoot,
        listProjectLocations: async () => [],
      } as never,
      codex: {
        getReady: async () => ({
          request: async () => ({
            data: [
              {
                id: 'thread-root',
                cwd: userRoot,
                preview: 'Root chat',
                createdAt: 1,
                updatedAt: 2,
              },
            ],
          }),
        }),
      } as never,
    },
    { trustedOrigins: [] },
  )
  const context = {
    owner: { ownerId: 'owner-root-threads' },
  } as OwnerMethodContext

  await assert.doesNotReject(async () => {
    const result = await services.threadsList(context, { projectId: null })
    assert.equal(result.kind, 'ok')
    assert.deepEqual(
      result.data.map((thread) => thread.id),
      ['thread-root'],
    )
  })
})

test('reports PASSKEY_REQUIRED when no local credential is registered', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-owner-passkey-options-'))
  let database: ReturnType<typeof createDatabase> | undefined
  try {
    prepareOwnerDatabase(testConfig(dataRoot))
    database = createDatabase(testConfig(dataRoot))
    database.db.insert(owner).values({ id: 'owner-passkey-options' }).run()
    const services = createOwnerApplicationServices(
      {
        workspace: { getOnlyOwnerId: async () => 'owner-passkey-options' } as never,
        codex: {} as never,
        ownerId: 'owner-passkey-options',
        database: database.db,
      },
      { trustedOrigins: ['http://localhost:5173'] },
    )
    const transport: OwnerTransport = {
      kind: 'local',
      origin: 'http://localhost:5173',
      send: () => undefined,
      close: () => undefined,
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
    }
    const context = {
      owner: null,
      connectionId: 'connection-passkey-options',
      transport,
      signal: new AbortController().signal,
      requestId: 'request-passkey-options',
      authenticate: () => undefined,
      unauthenticate: () => undefined,
    } as OwnerMethodContext

    await assert.rejects(
      services.passkeyAuthenticationOptions(context),
      (error: unknown) =>
        error instanceof OwnerMethodError && error.code === 'owner.auth.passkey-required',
    )
  } finally {
    database?.driver.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('lists stable skill paths for a root selection without handle state', async () => {
  const root = path.resolve('synthetic-owner-skills')
  const skill = {
    name: 'review',
    path: path.join(root, 'review', 'SKILL.md'),
    scope: 'repo',
    enabled: true,
    description: 'token=synthetic',
  }
  const services = createOwnerApplicationServices(
    {
      workspace: { getOnlyOwnerId: async () => 'owner', getUserRoot: () => root } as never,
      codex: {
        getReady: async () => ({
          request: async (method: string, params: unknown) => {
            assert.equal(method, 'skills/list')
            assert.deepEqual(params, { cwds: [root] })
            return { data: [{ cwd: root, skills: [skill] }] }
          },
        }),
      } as never,
    },
    { trustedOrigins: [] },
  )
  const context = { owner: { ownerId: 'owner' } } as OwnerMethodContext
  const expected = [
    {
      name: skill.name,
      path: skill.path,
      scope: 'repo',
      displayName: 'review',
      description: 'token=synthetic',
    },
  ]
  assert.deepEqual(await services.skillsList(context, { projectId: null }), expected)
  assert.deepEqual(await services.skillsList(context, {}), expected)
})
