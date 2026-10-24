import assert from 'node:assert/strict'
import test from 'node:test'

import { createThreadAccess } from './thread-access.js'

const workspace = {
  getUserRoot: () => 'C:/test',
  getProject: async (_userId: string, projectId: string) =>
    projectId === 'project-id' ? { id: projectId, path: 'C:/test/demo', name: 'demo' } : undefined,
  listProjectLocations: async () => [{ id: 'project-id', path: 'C:/test/demo' }],
}

test('authorizes a project thread and passes read options to Codex', async () => {
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const access = createThreadAccess({
    workspace,
    codex: {
      getReady: async () => ({
        request: async (method, params) => {
          requests.push({ method, params })
          if (method === 'thread/read') return { thread: { id: 'thread-id', cwd: 'C:/test/demo' } }
          return { data: [{ id: 'thread-id', cwd: 'C:/test/demo' }], nextCursor: null }
        },
      }),
    },
  })

  const result = await access.access({
    userId: 'user-id',
    threadId: 'thread-id',
    projectId: 'project-id',
    mode: 'read',
    includeTurns: true,
  })
  assert.equal(result.kind, 'owned')
  assert.deepEqual(requests, [
    { method: 'thread/read', params: { threadId: 'thread-id', includeTurns: true } },
  ])
})

test('rejects a root access for a project-owned thread', async () => {
  const access = createThreadAccess({
    workspace,
    codex: {
      getReady: async () => ({
        request: async (method) =>
          method === 'thread/read'
            ? { thread: { id: 'thread-id', cwd: 'C:/test/demo' } }
            : { data: [], nextCursor: null },
      }),
    },
  })
  const result = await access.access({ userId: 'user-id', threadId: 'thread-id', mode: 'read' })
  assert.deepEqual(result, { kind: 'not_found' })
})

test('returns start-required without a ready client', async () => {
  const access = createThreadAccess({ workspace, codex: {} })
  assert.deepEqual(
    await access.access({
      userId: 'user-id',
      threadId: 'thread-id',
      projectId: 'project-id',
      mode: 'read',
    }),
    { kind: 'codex_start_required' },
  )
})
