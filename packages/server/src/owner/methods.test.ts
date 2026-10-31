import assert from 'node:assert/strict'
import test from 'node:test'

import type { OwnerApplicationServices } from './application-services.js'
import { createOwnerMethodRegistry } from './methods.js'

test('exposes Owner security status to authenticated remote sessions', () => {
  const registry = createOwnerMethodRegistry({} as OwnerApplicationServices)
  assert.equal(registry.get('owner.security.status')?.access, 'authenticated')
  assert.equal(registry.get('owner.enrollment.issue')?.access, 'authenticated')
  assert.equal(registry.get('owner.enrollment.status')?.access, 'authenticated')
  assert.equal(registry.get('owner.enrollment.cancel')?.access, 'authenticated')
  assert.equal(registry.get('owner.enrollment.redeem')?.access, 'public')
  for (const retired of [
    'owner.firstSession.redeem',
    'owner.recovery.login.reserve',
    'owner.recovery.login.finish',
    'owner.recovery.generate',
    'remote.loginQr.issue',
    'remote.loginQr.status',
    'remote.loginQr.cancel',
    'remote.loginQr.consume',
  ])
    assert.equal(registry.has(retired), false, retired)
})
