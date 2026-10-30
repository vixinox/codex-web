import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureOwnerInitialized } from './owner-initialization.js'

test('initializes one Owner without terminal credentials or second-factor setup', async () => {
  let ownerId: string | null = null
  let creations = 0
  const workspace = {
    async getOnlyOwnerId() {
      return ownerId
    },
    async createOwner(value: string) {
      ownerId = value
      creations += 1
    },
  }
  const first = await ensureOwnerInitialized(workspace)
  const second = await ensureOwnerInitialized(workspace)
  assert.match(first, /^[0-9a-f-]{36}$/u)
  assert.equal(second, first)
  assert.equal(creations, 1)
})
