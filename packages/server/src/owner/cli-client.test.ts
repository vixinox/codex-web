import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { connectOwnerCli } from './cli-client.js'
import { startOwnerIpcServer } from './ipc.js'
import { OWNER_IPC_MANAGEMENT_COMMANDS } from './ipc-management.js'

test('CLI requires a running Owner and does not initialize its data directory', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'codex-cli-offline-'))
  const dataRoot = path.join(parent, 'not-created')
  try {
    await assert.rejects(connectOwnerCli({ dataRoot }), /pnpm server/)
    await assert.rejects(stat(dataRoot), { code: 'ENOENT' })
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('CLI exit leaves the running Owner login link alive; mutations use fixed IPC commands', async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'codex-cli-online-'))
  const calls: Array<[string, unknown]> = []
  let invitation = false
  const server = await startOwnerIpcServer(
    dataRoot,
    async (command, params) => {
      calls.push([command, params])
      if (command === 'owner.ready') return { ready: true }
      if (command === 'enrollment.issue') {
        invitation = true
        return { reference: 'test-reference' }
      }
      if (command === 'devices.list') return []
      return { revoked: true }
    },
    OWNER_IPC_MANAGEMENT_COMMANDS,
  )
  server.markReady()
  try {
    const first = await connectOwnerCli({ dataRoot })
    await first.localManagement.enrollmentIssue()
    assert.equal(invitation, true)
    const second = await connectOwnerCli({ dataRoot })
    assert.deepEqual(await second.localManagement.listDevices(), [])
    await second.localManagement.revokeDevice('device-1')
    assert.equal(invitation, true)
    assert.ok(
      calls.some(
        ([command, params]) =>
          command === 'devices.revoke' && (params as { deviceId: string }).deviceId === 'device-1',
      ),
    )
    assert.equal(
      (await readdir(dataRoot)).some((file) => file.endsWith('.sqlite')),
      false,
    )
  } finally {
    await server.close()
    await rm(dataRoot, { recursive: true, force: true })
  }
})
