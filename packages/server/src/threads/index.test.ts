import assert from 'node:assert/strict'
import test from 'node:test'

import { createThreadDomain } from './index.js'

const workspace = {
  getUserRoot: () => 'C:/test',
  getProject: async (_userId: string, projectId: string) =>
    projectId === 'project-id' ? { id: projectId, path: 'C:/test/demo', name: 'demo' } : undefined,
  listProjectLocations: async () => [{ id: 'project-id', path: 'C:/test/demo' }],
}

test('combines thread access, collection, and safe summary projection', async () => {
  const domain = createThreadDomain({
    workspace,
    codex: {
      getReady: async () => ({
        request: async (method) => {
          if (method === 'thread/read') return { thread: { id: 'thread-id', cwd: 'C:/test/demo' } }
          return {
            data: [
              {
                id: 'thread-id',
                cwd: 'C:/test/demo',
                preview: 'A thread',
                createdAt: 1,
                updatedAt: 2,
              },
            ],
            nextCursor: null,
          }
        },
      }),
    },
  })

  const access = await domain.access({
    userId: 'user-id',
    threadId: 'thread-id',
    projectId: 'project-id',
    mode: 'read',
  })
  assert.equal(access.kind, 'owned')

  const listed = await domain.list({
    userId: 'user-id',
    projectId: 'project-id',
    limit: 25,
    archived: false,
  })
  assert.deepEqual(listed, {
    kind: 'ok',
    data: [
      {
        id: 'thread-id',
        projectId: 'project-id',
        title: 'A thread',
        status: 'notLoaded',
        createdAt: 1,
        updatedAt: 2,
        recencyAt: null,
        modelProvider: 'unknown',
      },
    ],
    nextCursor: null,
  })

  const projects = domain.createProjectPathIndex(await workspace.listProjectLocations())
  assert.equal(domain.projectIdFor({ cwd: 'C:/test/demo' }, projects), 'project-id')
  assert.equal(domain.pathIsWithin('C:/test/demo', 'C:/test'), true)
})
