import assert from 'node:assert/strict'
import test from 'node:test'

import type { OwnerApplicationServices } from './application-services.js'
import { createOwnerMethodRegistry } from './methods.js'

test('exposes Owner security status to authenticated remote sessions', () => {
  const registry = createOwnerMethodRegistry({} as OwnerApplicationServices)
  assert.equal(registry.get('owner.security.status')?.access, 'authenticated')
})
