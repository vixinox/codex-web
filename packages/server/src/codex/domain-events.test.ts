import assert from 'node:assert/strict'
import test from 'node:test'
import { workspaceEvent } from './domain-events.js'

test('routes workspace notifications once and retains their original content', () => {
  for (const method of [
    'skills/changed',
    'project/changed',
    'thread/archived',
    'thread/unarchived',
    'thread/closed',
    'thread/deleted',
    'thread/settings/updated',
  ]) {
    const params = { threadId: 'thread-1', cwd: 'C:/synthetic/workspace', text: 'token=synthetic' }
    const event = workspaceEvent({ method, params })
    assert.equal(event?.type, `codex.${method}`)
    assert.deepEqual(event?.payload, params)
    assert.equal(event?.threadId, undefined)
  }
})

test('does not duplicate Conversation notifications or create raw extension events', () => {
  assert.equal(
    workspaceEvent({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1' } }),
    undefined,
  )
  assert.equal(
    workspaceEvent({ method: 'future/unknown', params: { secret: 'synthetic' } }),
    undefined,
  )
  assert.equal(workspaceEvent({ method: 'skills/changed', params: [] }), undefined)
})
