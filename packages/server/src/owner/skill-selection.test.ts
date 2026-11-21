import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { parseSkills, resolveSelectedSkills } from './skill-selection.js'
import { summarizeSkill, type NativeSkill } from '../skills.js'

const cwd = path.resolve('synthetic-project')
const selected = { name: 'review', path: path.join(cwd, '.agents', 'skills', 'review', 'SKILL.md') }
const native: NativeSkill = {
  ...selected,
  description: 'token=synthetic',
  scope: 'repo',
  enabled: true,
  interface: null,
  shortDescription: null,
}

test('skill selection is stable and rejects invalid, duplicate and excessive inputs', () => {
  assert.deepEqual(parseSkills(undefined), [])
  assert.deepEqual(parseSkills([selected]), [selected])
  assert.equal(parseSkills([selected, selected]), null)
  assert.equal(
    parseSkills(Array.from({ length: 33 }, (_, i) => ({ name: String(i), path: String(i) }))),
    null,
  )
  for (const input of [null, ['old-handle'], [{}], [{ name: 'review', path: '' }]])
    assert.equal(parseSkills(input), null)
  assert.deepEqual(summarizeSkill(native), {
    ...selected,
    description: native.description,
    displayName: 'review',
    scope: 'repo',
  })
})

test('resolves against the current cwd catalog without a handle cache or expiration', async () => {
  let available = [native]
  const calls: unknown[] = []
  const client = {
    async request(method: string, params?: Record<string, unknown>) {
      calls.push([method, params])
      return { data: [{ cwd, skills: available }] }
    },
  }
  assert.deepEqual(await resolveSelectedSkills(client, cwd, [selected]), [native])
  assert.deepEqual(await resolveSelectedSkills(client, cwd, [selected]), [native])
  assert.deepEqual(
    calls,
    Array.from({ length: 2 }, () => ['skills/list', { cwds: [cwd], forceReload: true }]),
  )
  assert.equal(
    await resolveSelectedSkills(client, cwd, [{ ...selected, path: path.resolve('forged') }]),
    null,
  )
  assert.equal(await resolveSelectedSkills(client, path.resolve('other-project'), [selected]), null)
  available = [{ ...native, enabled: false }]
  assert.equal(await resolveSelectedSkills(client, cwd, [selected]), null)
  available = []
  assert.equal(await resolveSelectedSkills(client, cwd, [selected]), null)
})
