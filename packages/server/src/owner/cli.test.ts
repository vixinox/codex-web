import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { CANCEL_SYMBOL } from '@clack/prompts'

import {
  parseOwnerCliCommand,
  parseOwnerCliInvocation,
  runOwnerCliCommand,
  runOwnerCliMenu,
  selectOwnerCliDevice,
  selectOwnerCliMenuAction,
} from './cli.js'

test('uses a menu only for no-argument TTY invocation', () => {
  assert.deepEqual(parseOwnerCliInvocation([], true), { mode: 'menu' })
  assert.throws(() => parseOwnerCliInvocation([], false), /Usage:/u)
  assert.deepEqual(parseOwnerCliInvocation(['devices', 'list'], false), {
    mode: 'command',
    command: { kind: 'devices-list' },
  })
})

test('maps menu selections and cancellation to command actions', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  const selection = await selectOwnerCliMenuAction({ stdin, stdout }, async (options) => {
    assert.equal(options.options.length, 5)
    assert.equal(options.options[0]?.label, '生成登录链接')
    return 'devices-revoke-menu'
  })
  assert.deepEqual(selection, { kind: 'devices-revoke-menu' })

  const cancelled = await selectOwnerCliMenuAction({ stdin, stdout }, async () => CANCEL_SYMBOL)
  assert.deepEqual(cancelled, { kind: 'menu-exit' })
})

test('device selection handles empty lists, a chosen device, and cancellation', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  assert.equal(await selectOwnerCliDevice([], { stdin, stdout }), null)

  let options: Array<{ value: string; label?: string }> = []
  const selected = await selectOwnerCliDevice(
    [{ id: 'device-1', lastSeenAt: '2026-10-29' }],
    { stdin, stdout },
    async (input) => {
      options = input.options
      return 'device-1'
    },
  )
  assert.equal(selected, 'device-1')
  assert.deepEqual(options, [{ value: 'device-1', label: 'device-1', hint: '最近活动 2026-10-29' }])

  assert.equal(
    await selectOwnerCliDevice([{ id: 'device-1' }], { stdin, stdout }, async () => CANCEL_SYMBOL),
    null,
  )
})

test('menu handles empty devices, cancellation, selected removal and failures before returning to the next action', async () => {
  const actions = [
    { kind: 'devices-revoke-menu' },
    { kind: 'devices-revoke-menu' },
    { kind: 'devices-revoke-menu' },
    { kind: 'devices-list' },
    { kind: 'menu-exit' },
  ] as const
  let index = 0
  let listed = 0
  let selected = 0
  const events: string[] = []
  await runOwnerCliMenu({
    async connectClient() {
      return {
        localManagement: { listDevices: async () => (++listed === 1 ? [] : [{ id: 'device-1' }]) },
      } as never
    },
    selectAction: async () => actions[index++],
    selectDevice: async () => (++selected === 1 ? null : 'device-1'),
    async runCommand(command) {
      if (command.kind === 'devices-revoke') events.push(command.deviceId)
      else throw new Error('listing failed')
    },
    reportInfo: (message) => {
      events.push(message)
    },
    reportError: (error) => {
      events.push(error instanceof Error ? error.message : String(error))
    },
  })
  assert.deepEqual(events, ['No registered remote devices.', 'device-1', 'listing failed'])
  assert.equal(index, actions.length)
})

test('rejects unknown commands and unsafe device identifiers', () => {
  assert.throws(() => parseOwnerCliCommand(['auth', 'secret']), /Usage:/u)
  assert.throws(
    () => parseOwnerCliCommand(['devices', 'revoke', '../owner.sqlite']),
    /Invalid device/u,
  )
})

test('only device and invitation commands remain, and removal requires confirmation', async () => {
  assert.deepEqual(parseOwnerCliCommand(['enrollment', 'issue']), { kind: 'enrollment-issue' })
  assert.deepEqual(parseOwnerCliCommand(['devices', 'revoke-all']), { kind: 'devices-revoke-all' })
  for (const args of [
    ['auth', 'status'],
    ['auth', 'sessions', 'revoke-all'],
    ['enrollment', 'recover'],
    ['enrollment', 'cancel'],
    ['trust', 'reset'],
  ])
    assert.throws(() => parseOwnerCliCommand(args), /Usage:/)
  let removed = false
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  const services = {
    localManagement: {
      revokeAllDevices: async () => {
        removed = true
        return {}
      },
    },
  } as never
  await runOwnerCliCommand(
    { kind: 'devices-revoke-all' },
    services,
    { stdin, stdout, stderr: stdout } as never,
    { confirm: async () => false },
  )
  assert.equal(removed, false)
  stdin.isTTY = false
  await assert.rejects(
    runOwnerCliCommand({ kind: 'devices-revoke-all' }, services, {
      stdin,
      stdout,
      stderr: stdout,
    } as never),
    /interactive terminal/,
  )
})

test('enrollment issue prints a one-time login URL and QR without confirmation', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  let output = ''
  stdout.on('data', (chunk) => (output += chunk.toString()))
  let rotateCalled = false

  await runOwnerCliCommand(
    { kind: 'enrollment-issue' },
    {
      localManagement: {
        enrollmentIssue: async () => {
          rotateCalled = true
          return {
            reference: 'reference-for-cli-test',
            expiresAt: '2026-10-30T13:08:00.000Z',
            appOrigin: 'http://localhost:5173',
          }
        },
      },
    } as never,
    { stdin, stdout, stderr: stdout } as never,
    {
      confirm: async () => {
        throw new Error('invitation issuance should not ask for confirmation')
      },
    },
  )

  assert.equal(rotateCalled, true)
  assert.match(output, /One-time login URL/u)
  assert.match(output, /http:\/\/localhost:5173\/app\/enroll\?ref=reference-for-cli-test/u)
  assert.match(output, /2026-10-30T13:08:00\.000Z/u)
  assert.equal(output.includes('First-session'), false)
  assert.equal(output.includes('Result'), false)
})

test('read-only commands keep JSON output in non-interactive terminals', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', (chunk) => (output += chunk.toString()))
  await runOwnerCliCommand(
    { kind: 'devices-list' },
    { localManagement: { listDevices: async () => [{ id: 'device-1' }] } } as never,
    { stdin, stdout, stderr: stdout } as never,
  )
  assert.deepEqual(JSON.parse(output), [{ id: 'device-1' }])
})
