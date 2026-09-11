import 'dotenv/config'

import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import test from 'node:test'

import { createAuth } from './auth.js'
import { buildOwnerServer } from './owner/app.js'
import { loadServerConfig } from './config.js'
import { createDatabase } from './database.js'
import { createWorkspaceService } from './workspace.js'
import { CodexManager } from './codex/manager.js'
import { PostgresEventStore } from './codex/event-store.js'

test('persists a Better Auth session across server and pool recreation', async () => {
  const config = loadServerConfig('owner')
  const email = `integration-${Date.now()}@example.com`

  const firstDatabase = createDatabase(config)
  config.allowedOutboundHosts = ['api.example.com']
  const firstWorkspace = createWorkspaceService(config, firstDatabase.db, async () => {})
  const firstApp = await buildOwnerServer(config, {
    auth: createAuth(config, firstDatabase.db),
    workspace: firstWorkspace,
    codex: new CodexManager(config, firstWorkspace),
  })
  const signUp = await firstApp.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: config.trustedOrigins[0] },
    payload: { name: 'Integration User', email, password: 'integration-password-123' },
  })
  assert.equal(signUp.statusCode, 200, signUp.body)
  const cookieHeader = signUp.headers['set-cookie']
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader])
    .filter(Boolean)
    .map((value) => String(value).split(';', 1)[0])
    .join('; ')
  assert.match(cookie, /better-auth\.session_token/)
  const userId = signUp.json().user.id as string
  const eventStore = new PostgresEventStore(firstDatabase.db)
  await eventStore.append(userId, {
    id: 900000,
    message: { method: 'turn/started', params: { threadId: 'integration-thread' } },
  })
  const restoredEvents = await eventStore.load()
  assert.equal(restoredEvents.events[userId]?.[0]?.message.method, 'turn/started')
  const project = await firstApp.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie, origin: config.trustedOrigins[0] },
    payload: { name: 'integration-project' },
  })
  assert.equal(project.statusCode, 201, project.body)
  assert.equal('path' in project.json(), false)
  const credential = await firstApp.inject({
    method: 'POST',
    url: '/api/credentials',
    headers: { cookie, origin: config.trustedOrigins[0] },
    payload: {
      provider: 'openai',
      baseUrl: 'https://api.example.com/',
      apiKey: 'sk-integration-secret',
    },
  })
  assert.equal(credential.statusCode, 201, credential.body)
  assert.equal(credential.body.includes('sk-integration-secret'), false)
  const firstCredentialId = credential.json().id as string
  const secondCredential = await firstApp.inject({
    method: 'POST',
    url: '/api/credentials',
    headers: { cookie, origin: config.trustedOrigins[0] },
    payload: {
      provider: 'openai',
      baseUrl: 'https://api.example.com/second',
      apiKey: 'sk-integration-secret-2',
    },
  })
  assert.equal(secondCredential.statusCode, 201, secondCredential.body)
  const secondCredentialId = secondCredential.json().id as string
  const credentials = await firstApp.inject({
    method: 'GET',
    url: '/api/credentials',
    headers: { cookie },
  })
  assert.equal(credentials.statusCode, 200)
  assert.equal(credentials.body.includes('sk-integration-secret'), false)
  assert.equal(credentials.json().currentCredentialId, firstCredentialId)
  const invalidCredential = await firstApp.inject({
    method: 'POST',
    url: '/api/credentials',
    headers: { cookie },
    payload: { provider: 'openai', baseUrl: 'http://api.example.com', apiKey: 'secret' },
  })
  assert.equal(invalidCredential.statusCode, 400)
  await firstApp.close()
  await firstDatabase.pool.end()

  const secondDatabase = createDatabase(config)
  const secondWorkspace = createWorkspaceService(config, secondDatabase.db, async () => {})
  const secondApp = await buildOwnerServer(config, {
    auth: createAuth(config, secondDatabase.db),
    workspace: secondWorkspace,
    codex: new CodexManager(config, secondWorkspace),
  })
  try {
    const me = await secondApp.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    assert.equal(me.statusCode, 200, me.body)
    assert.equal(me.json().user.email, email)
    const persistedCredentials = await secondApp.inject({
      method: 'GET',
      url: '/api/credentials',
      headers: { cookie },
    })
    assert.equal(persistedCredentials.statusCode, 200, persistedCredentials.body)
    assert.equal(persistedCredentials.json().currentCredentialId, firstCredentialId)
    const deletedCurrent = await secondApp.inject({
      method: 'DELETE',
      url: `/api/credentials/${firstCredentialId}`,
      headers: { cookie },
    })
    assert.equal(deletedCurrent.statusCode, 204, deletedCurrent.body)
    const fallbackCredentials = await secondApp.inject({
      method: 'GET',
      url: '/api/credentials',
      headers: { cookie },
    })
    assert.equal(fallbackCredentials.json().currentCredentialId, secondCredentialId)
  } finally {
    await secondApp.close()
    await secondDatabase.pool.query('DELETE FROM "user" WHERE "id" = $1', [userId])
    await secondDatabase.pool.end()
    await rm(`${config.dataRoot}/users/${userId}`, { recursive: true, force: true })
  }
})
