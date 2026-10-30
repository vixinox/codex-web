import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOwnerIpcManagementDispatcher,
  OWNER_IPC_MANAGEMENT_COMMANDS,
} from './ipc-management.js'

test('Owner IPC management allowlist matches the fixed local command surface', async () => {
  const calls: Array<[string, unknown?]> = []
  const invoke = (name: string) => async (value?: unknown) => {
    calls.push([name, value])
    return { name, value }
  }
  const services = {
    localManagement: {
      authStatus: invoke('auth.status'),
      bootstrapRotate: invoke('bootstrap.rotate'),
      bootstrapRecover: invoke('bootstrap.recover'),
      rotateRecoveryCodes: invoke('recovery.rotate'),
      revokeAllSessions: invoke('sessions.revoke-all'),
      listDevices: invoke('devices.list'),
      revokeDevice: invoke('devices.revoke'),
      revokeAllDevices: invoke('devices.revoke-all'),
      ownerCodeShow: invoke('owner-code.show'),
      ownerCodeRotate: invoke('owner-code.rotate'),
      trustReset: invoke('trust.reset'),
    },
  }
  const dispatch = createOwnerIpcManagementDispatcher(services)

  assert.deepEqual(await dispatch('owner.ready', undefined), { ready: true })
  assert.deepEqual(await dispatch('devices.revoke', { deviceId: 'device-1' }), {
    name: 'devices.revoke',
    value: 'device-1',
  })
  assert.deepEqual(calls, [['devices.revoke', 'device-1']])
  assert.equal(OWNER_IPC_MANAGEMENT_COMMANDS.has('owner.session.open'), false)
  await assert.rejects(dispatch('owner.session.open', undefined), /COMMAND_NOT_ALLOWED/u)
  await assert.rejects(dispatch('devices.revoke', { deviceId: '../other' }), /INVALID_DEVICE_ID/u)
  await assert.rejects(
    dispatch('devices.revoke', { deviceId: 'device-1', path: 'ignored' }),
    /INVALID_DEVICE_ID/u,
  )
})
