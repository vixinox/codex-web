import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { CANCEL_SYMBOL } from '@clack/prompts'

import {
  OWNER_CLI_IPC_COMMANDS,
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
  assert.deepEqual(parseOwnerCliInvocation(['auth', 'status'], false), {
    mode: 'command',
    command: { kind: 'auth-status' },
  })
})

test('maps menu selections and cancellation to command actions', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  const selection = await selectOwnerCliMenuAction({ stdin, stdout }, async (options) => {
    assert.equal(options.options.length, 12)
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

test('menu returns after each action and always closes each runtime', async () => {
  const selections: Array<{ kind: 'auth-status' } | { kind: 'menu-exit' }> = [
    { kind: 'auth-status' },
    { kind: 'menu-exit' },
  ]
  const events: string[] = []
  await runOwnerCliMenu({
    async createRuntime(command) {
      events.push(`open:${command.kind}`)
      return {
        services: {} as never,
        async close() {
          events.push(`close:${command.kind}`)
        },
      }
    },
    async selectAction() {
      return selections.shift() ?? { kind: 'menu-exit' }
    },
    async selectDevice() {
      return null
    },
    async runCommand(command) {
      events.push(`run:${command.kind}`)
    },
    async listDevices() {
      return []
    },
    reportInfo(message) {
      events.push(`info:${message}`)
    },
    reportError(error) {
      events.push(`error:${String(error)}`)
    },
  })
  assert.deepEqual(events, ['open:auth-status', 'run:auth-status', 'close:auth-status'])
})

test('device menu action returns to menu for empty or cancelled selection', async () => {
  for (const devices of [[], [{ id: 'device-1' }]]) {
    const events: string[] = []
    const actions: Array<{ kind: 'devices-revoke-menu' } | { kind: 'menu-exit' }> = [
      { kind: 'devices-revoke-menu' },
      { kind: 'menu-exit' },
    ]
    await runOwnerCliMenu({
      async createRuntime(command) {
        events.push(`open:${command.kind}`)
        return {
          services: {} as never,
          async close() {
            events.push(`close:${command.kind}`)
          },
        }
      },
      async selectAction() {
        return actions.shift() ?? { kind: 'menu-exit' }
      },
      async selectDevice() {
        return devices.length === 0 ? null : null
      },
      async runCommand() {
        events.push('run')
      },
      async listDevices() {
        return devices
      },
      reportInfo(message) {
        events.push(`info:${message}`)
      },
      reportError(error) {
        events.push(`error:${error instanceof Error ? error.message : String(error)}`)
      },
    })
    assert.equal(events.includes('run'), false)
    assert.equal(events.filter((event) => event.startsWith('close:')).length, 1)
    if (devices.length === 0)
      assert.ok(events.some((event) => event === 'info:No registered remote devices.'))
  }
})

test('device menu selection runs the existing revoke command path', async () => {
  const events: string[] = []
  const actions: Array<{ kind: 'devices-revoke-menu' } | { kind: 'menu-exit' }> = [
    { kind: 'devices-revoke-menu' },
    { kind: 'menu-exit' },
  ]
  await runOwnerCliMenu({
    async createRuntime(command) {
      events.push(`open:${command.kind}`)
      return {
        services: {} as never,
        async close() {
          events.push(`close:${command.kind}`)
        },
      }
    },
    async selectAction() {
      return actions.shift() ?? { kind: 'menu-exit' }
    },
    async selectDevice() {
      return 'device-1'
    },
    async runCommand(command) {
      events.push(
        `run:${command.kind}:${command.kind === 'devices-revoke' ? command.deviceId : ''}`,
      )
    },
    async listDevices() {
      return [{ id: 'device-1' }]
    },
    reportInfo() {},
    reportError(error) {
      events.push(`error:${String(error)}`)
    },
  })
  assert.deepEqual(events, [
    'open:devices-list',
    'close:devices-list',
    'open:devices-revoke',
    'run:devices-revoke:device-1',
    'close:devices-revoke',
  ])
})

test('menu reports operation failures, closes runtime, and continues', async () => {
  const events: string[] = []
  const actions: Array<{ kind: 'auth-status' } | { kind: 'menu-exit' }> = [
    { kind: 'auth-status' },
    { kind: 'menu-exit' },
  ]
  await runOwnerCliMenu({
    async createRuntime() {
      return {
        services: {} as never,
        async close() {
          events.push('closed')
        },
      }
    },
    async selectAction() {
      return actions.shift() ?? { kind: 'menu-exit' }
    },
    async selectDevice() {
      return null
    },
    async runCommand() {
      throw new Error('operation failed')
    },
    async listDevices() {
      return []
    },
    reportInfo() {},
    reportError(error) {
      events.push(error instanceof Error ? error.message : String(error))
    },
  })
  assert.deepEqual(events, ['closed', 'operation failed'])
})

test('parses supported Owner management commands', () => {
  assert.deepEqual(parseOwnerCliCommand(['auth', 'status']), { kind: 'auth-status' })
  assert.deepEqual(parseOwnerCliCommand(['bootstrap', 'rotate']), { kind: 'bootstrap-rotate' })
  assert.deepEqual(parseOwnerCliCommand(['bootstrap', 'recover']), { kind: 'bootstrap-recover' })
  assert.deepEqual(parseOwnerCliCommand(['devices', 'revoke', 'device-1']), {
    kind: 'devices-revoke',
    deviceId: 'device-1',
  })
  assert.deepEqual(parseOwnerCliCommand(['trust', 'reset']), { kind: 'trust-reset' })
})

test('removes legacy TOTP reset command and fixes the IPC command allowlist', () => {
  assert.throws(() => parseOwnerCliCommand(['auth', 'totp', 'reset']), /Usage:/u)
  assert.deepEqual(OWNER_CLI_IPC_COMMANDS, {
    'auth-status': 'auth.status',
    'bootstrap-rotate': 'bootstrap.rotate',
    'bootstrap-recover': 'bootstrap.recover',
    'recovery-rotate': 'recovery.rotate',
    'sessions-revoke-all': 'sessions.revoke-all',
    'devices-list': 'devices.list',
    'devices-revoke': 'devices.revoke',
    'devices-revoke-all': 'devices.revoke-all',
    'owner-code-show': 'owner-code.show',
    'owner-code-rotate': 'owner-code.rotate',
    'trust-reset': 'trust.reset',
  })
})

test('rejects unknown commands and unsafe device identifiers', () => {
  assert.throws(() => parseOwnerCliCommand(['auth', 'secret']), /Usage:/u)
  assert.throws(
    () => parseOwnerCliCommand(['devices', 'revoke', '../owner.sqlite']),
    /Invalid device/u,
  )
})

test('bootstrap recovery requires explicit confirmation', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  let confirmed = false

  await runOwnerCliCommand(
    { kind: 'bootstrap-recover' },
    {
      localManagement: {
        authStatus: async () => ({}),
        bootstrapRecover: async () => ({ recovery: true }),
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
    { stdin, stdout, stderr: stdout } as never,
    {
      confirm: async () => {
        confirmed = true
        return true
      },
    },
  )

  assert.equal(confirmed, true)
})

test('refuses destructive bootstrap recovery from a non-interactive terminal', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const output = new PassThrough()
  await assert.rejects(
    () =>
      runOwnerCliCommand(
        { kind: 'bootstrap-recover' },
        { localManagement: { bootstrapRecover: async () => ({ reset: true }) } } as never,
        { stdin, stdout: output, stderr: output } as never,
      ),
    /interactive terminal/u,
  )
})

test('cancelling bootstrap recovery confirmation does not call the service', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  let resetCalled = false
  await runOwnerCliCommand(
    { kind: 'bootstrap-recover' },
    {
      localManagement: {
        bootstrapRecover: async () => {
          resetCalled = true
          return {}
        },
      },
    } as never,
    { stdin, stdout, stderr: stdout } as never,
    { confirm: async () => false },
  )
  assert.equal(resetCalled, false)
})

test('read-only commands keep JSON output in non-interactive terminals', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', (chunk) => (output += chunk.toString()))
  await runOwnerCliCommand(
    { kind: 'auth-status' },
    { localManagement: { authStatus: async () => ({ authenticated: true }) } } as never,
    { stdin, stdout, stderr: stdout } as never,
  )
  assert.equal(output, '{\n  "authenticated": true\n}\n')
})

test('prints rotated recovery codes as plain lines in TTY output', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true })
  const stdout = Object.assign(new PassThrough(), { isTTY: true })
  const stderr = new PassThrough()
  let output = ''
  stdout.on('data', (chunk) => (output += chunk.toString()))

  await runOwnerCliCommand(
    { kind: 'recovery-rotate' },
    {
      localManagement: {
        rotateRecoveryCodes: async () => ({ recoveryCodes: ['CODE-ONE', 'CODE-TWO'] }),
      },
    } as never,
    { stdin, stdout, stderr } as never,
    { confirm: async () => true },
  )

  assert.match(output, /CODE-ONE\r?\nCODE-TWO\r?\n/u)
  assert.equal(output.includes('Result'), false)
  assert.equal(output.includes('"recoveryCodes"'), false)
  assert.equal(output.includes('│'), false)
})

test('refuses recovery-code rotation from a non-interactive terminal', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: false })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let output = ''
  stdout.on('data', (chunk) => (output += chunk.toString()))
  let rotateCalled = false
  await assert.rejects(
    runOwnerCliCommand(
      { kind: 'recovery-rotate' },
      {
        localManagement: {
          rotateRecoveryCodes: async () => {
            rotateCalled = true
            return { recoveryCodes: ['CODE-ONE'] }
          },
        },
      } as never,
      { stdin, stdout, stderr } as never,
    ),
    /interactive terminal/u,
  )
  assert.equal(rotateCalled, false)
  assert.equal(output, '')
})
