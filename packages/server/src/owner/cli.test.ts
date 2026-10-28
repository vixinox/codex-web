import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { parseOwnerCliCommand, runOwnerCliCommand } from './cli.js'

test('parses supported Owner management commands', () => {
  assert.deepEqual(parseOwnerCliCommand(['auth', 'status']), { kind: 'auth-status' })
  assert.deepEqual(parseOwnerCliCommand(['auth', 'totp', 'reset']), { kind: 'totp-reset' })
  assert.deepEqual(parseOwnerCliCommand(['devices', 'revoke', 'device-1']), {
    kind: 'devices-revoke',
    deviceId: 'device-1',
  })
  assert.deepEqual(parseOwnerCliCommand(['trust', 'reset']), { kind: 'trust-reset' })
})

test('rejects unknown commands and unsafe device identifiers', () => {
  assert.throws(() => parseOwnerCliCommand(['auth', 'secret']), /Usage:/u)
  assert.throws(
    () => parseOwnerCliCommand(['devices', 'revoke', '../owner.sqlite']),
    /Invalid device/u,
  )
})

test('TOTP reset reads the Owner password without echo and rejects password arguments', async () => {
  assert.throws(() => parseOwnerCliCommand(['auth', 'totp', 'reset', 'owner-password']), /Usage:/u)
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    isRaw?: boolean
    setRawMode(value: boolean): void
  }
  Object.defineProperty(stdin, 'isTTY', { value: true })
  stdin.setRawMode = (value) => {
    stdin.isRaw = value
    if (value) setTimeout(() => stdin.write('owner-password\r'), 0)
  }
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let output = ''
  stdout.on('data', (chunk) => (output += chunk.toString()))
  stderr.on('data', (chunk) => (output += chunk.toString()))
  let receivedPassword = ''

  const command = runOwnerCliCommand(
    { kind: 'totp-reset' },
    {
      localManagement: {
        authStatus: async () => ({}),
        resetTotp: async (password) => {
          receivedPassword = password
          return { reset: true }
        },
        rotateRecoveryCodes: async () => ({}),
        revokeAllSessions: async () => ({}),
        listDevices: async () => [],
        revokeAllDevices: async () => ({}),
        revokeDevice: async () => ({}),
        ownerCodeShow: async () => ({}),
        ownerCodeRotate: async () => ({}),
        trustReset: async () => ({}),
      },
    },
    { stdin, stdout, stderr } as never,
  )
  setTimeout(() => stdin.write('yes\n'), 0)
  await command

  assert.equal(receivedPassword, 'owner-password')
  assert.equal(output.includes('owner-password'), false)
  assert.equal(stdin.isRaw, undefined)
})

test('refuses TOTP reset from a non-interactive terminal', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const output = new PassThrough()
  await assert.rejects(
    () =>
      runOwnerCliCommand(
        { kind: 'totp-reset' },
        { localManagement: { resetTotp: async () => ({ reset: true }) } } as never,
        { stdin, stdout: output, stderr: output } as never,
      ),
    /interactive terminal/u,
  )
})
