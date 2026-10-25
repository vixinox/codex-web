import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RemoteBootstrapStore } from './bootstrap-store.js'

test('binds one bootstrap capability to one client key and permits same-key reconnect', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'codex-web-bootstrap-'))
  try {
    const first = new RemoteBootstrapStore(dataRoot)
    const second = new RemoteBootstrapStore(dataRoot)
    const capability = await first.issue('node-1', 3)
    assert.equal(
      await second.authorizeAttach(capability.bootstrapId, 'node-1', 3, 'client-key'),
      true,
    )
    assert.ok(await first.bindLogin(capability.bootstrapId, 'node-1', 3, 'client-key'))
    assert.ok(await second.sessionExpiry(capability.bootstrapId, 'node-1', 3, 'client-key'))
    assert.equal(await second.bindLogin(capability.bootstrapId, 'node-1', 3, 'other-key'), null)
    assert.equal(
      await second.authorizeAttach(capability.bootstrapId, 'node-1', 4, 'client-key'),
      false,
    )
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
})
