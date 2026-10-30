import process from 'node:process'
import {
  cancel,
  confirm as clackConfirm,
  isCancel,
  log,
  note,
  select as clackSelect,
  spinner,
} from '@clack/prompts'

export type OwnerCliCommand =
  | { kind: 'auth-status' }
  | { kind: 'bootstrap-rotate' }
  | { kind: 'bootstrap-recover' }
  | { kind: 'recovery-rotate' }
  | { kind: 'sessions-revoke-all' }
  | { kind: 'devices-list' }
  | { kind: 'devices-revoke'; deviceId: string }
  | { kind: 'devices-revoke-all' }
  | { kind: 'owner-code-show' }
  | { kind: 'owner-code-rotate' }
  | { kind: 'trust-reset' }

export type OwnerCliMenuAction =
  | OwnerCliCommand
  | { kind: 'devices-revoke-menu' }
  | { kind: 'menu-exit' }

export const OWNER_CLI_USAGE =
  'Usage: codex-web-owner <auth status|bootstrap rotate|bootstrap recover|auth recovery rotate|auth sessions revoke-all|devices list|devices revoke <device-id>|devices revoke-all|owner-code show|owner-code rotate|trust reset>'

const MENU_LABELS: Record<OwnerCliCommand['kind'], string> = {
  'auth-status': '认证 · 查看状态',
  'bootstrap-rotate': '远程接入 · 重新生成首次连接码',
  'bootstrap-recover': '远程接入 · 恢复所有远程访问',
  'recovery-rotate': '认证 · 轮换恢复码',
  'sessions-revoke-all': '会话 · 撤销所有 Owner 会话',
  'devices-list': '设备 · 列出已登记设备',
  'devices-revoke': '设备 · 撤销指定设备',
  'devices-revoke-all': '设备 · 撤销所有设备',
  'owner-code-show': 'Owner code · 查看连接码',
  'owner-code-rotate': 'Owner code · 轮换连接码',
  'trust-reset': '信任 · 重置远程信任',
}

const MENU_ACTIONS: Array<{ kind: OwnerCliMenuAction['kind']; label: string }> = [
  { kind: 'auth-status', label: MENU_LABELS['auth-status'] },
  { kind: 'bootstrap-rotate', label: MENU_LABELS['bootstrap-rotate'] },
  { kind: 'bootstrap-recover', label: MENU_LABELS['bootstrap-recover'] },
  { kind: 'recovery-rotate', label: MENU_LABELS['recovery-rotate'] },
  { kind: 'sessions-revoke-all', label: MENU_LABELS['sessions-revoke-all'] },
  { kind: 'devices-list', label: MENU_LABELS['devices-list'] },
  { kind: 'devices-revoke-menu', label: MENU_LABELS['devices-revoke'] },
  { kind: 'devices-revoke-all', label: MENU_LABELS['devices-revoke-all'] },
  { kind: 'owner-code-show', label: MENU_LABELS['owner-code-show'] },
  { kind: 'owner-code-rotate', label: MENU_LABELS['owner-code-rotate'] },
  { kind: 'trust-reset', label: MENU_LABELS['trust-reset'] },
  { kind: 'menu-exit', label: '退出' },
]

const COMMAND_ACTIONS: OwnerCliCommand[] = [
  { kind: 'auth-status' },
  { kind: 'bootstrap-rotate' },
  { kind: 'bootstrap-recover' },
  { kind: 'recovery-rotate' },
  { kind: 'sessions-revoke-all' },
  { kind: 'devices-list' },
  { kind: 'devices-revoke-all' },
  { kind: 'owner-code-show' },
  { kind: 'owner-code-rotate' },
  { kind: 'trust-reset' },
]

export function requiresRemoteServices(command: OwnerCliCommand) {
  return [
    'devices-list',
    'devices-revoke',
    'devices-revoke-all',
    'owner-code-show',
    'owner-code-rotate',
    'trust-reset',
  ].includes(command.kind)
}

export function requiresRelayConnection(command: OwnerCliCommand) {
  return command.kind === 'owner-code-rotate'
}

export const OWNER_CLI_IPC_COMMANDS: Readonly<Record<OwnerCliCommand['kind'], string>> = {
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
}

export function parseOwnerCliInvocation(args: string[], interactive: boolean) {
  if (args.length === 0) {
    if (!interactive) throw new Error(OWNER_CLI_USAGE)
    return { mode: 'menu' as const }
  }
  return { mode: 'command' as const, command: parseOwnerCliCommand(args) }
}

export async function selectOwnerCliMenuAction(
  io: Pick<typeof process, 'stdout' | 'stdin'> = process,
  choose: typeof clackSelect = clackSelect,
): Promise<OwnerCliMenuAction> {
  const selected = await choose({
    message: 'Owner 管理操作',
    options: MENU_ACTIONS.map((action) => ({
      value: action.kind,
      label: action.label,
    })),
    input: io.stdin,
    output: io.stdout,
    maxItems: 11,
  })
  if (isCancel(selected) || selected === 'menu-exit') return { kind: 'menu-exit' }
  if (selected === 'devices-revoke-menu') return { kind: 'devices-revoke-menu' }
  const command = COMMAND_ACTIONS.find((action) => action.kind === selected)
  if (command) return command
  return { kind: 'menu-exit' }
}

export async function runOwnerCliMenu(dependencies: {
  createRuntime(command: OwnerCliCommand): Promise<{
    services: Parameters<typeof runOwnerCliCommand>[1]
    close(): Promise<void>
  }>
  selectAction(): Promise<OwnerCliMenuAction>
  selectDevice(devices: unknown[]): Promise<string | null>
  runCommand(
    command: OwnerCliCommand,
    services: Parameters<typeof runOwnerCliCommand>[1],
  ): Promise<void>
  listDevices(services: Parameters<typeof runOwnerCliCommand>[1]): Promise<unknown>
  reportInfo(message: string): void
  reportError(error: unknown): void
}) {
  /* oxlint-disable no-await-in-loop -- Each selected action must finish before the next menu prompt. */
  while (true) {
    const action = await dependencies.selectAction()
    if (action.kind === 'menu-exit') return

    try {
      if (action.kind === 'devices-revoke-menu') {
        const listCommand: OwnerCliCommand = { kind: 'devices-list' }
        const listingRuntime = await dependencies.createRuntime(listCommand)
        let deviceResult: unknown
        try {
          deviceResult = await dependencies.listDevices(listingRuntime.services)
        } finally {
          await listingRuntime.close()
        }
        if (!Array.isArray(deviceResult)) throw new Error('Remote device list is invalid.')
        const devices: unknown[] = deviceResult
        if (devices.length === 0) {
          dependencies.reportInfo('No registered remote devices.')
          continue
        }
        const selectedDeviceId = await dependencies.selectDevice(devices)
        if (!selectedDeviceId) continue
        const command: OwnerCliCommand = { kind: 'devices-revoke', deviceId: selectedDeviceId }
        const runtime = await dependencies.createRuntime(command)
        try {
          await dependencies.runCommand(command, runtime.services)
        } finally {
          await runtime.close()
        }
        continue
      }

      const runtime = await dependencies.createRuntime(action)
      try {
        await dependencies.runCommand(action, runtime.services)
      } finally {
        await runtime.close()
      }
    } catch (error) {
      dependencies.reportError(error)
    }
  }
  /* oxlint-enable no-await-in-loop */
}

export async function selectOwnerCliDevice(
  devices: unknown[],
  io: Pick<typeof process, 'stdout' | 'stdin'> = process,
  choose: typeof clackSelect = clackSelect,
): Promise<string | null> {
  const validDevices = devices.filter(
    (device): device is { id: string; lastSeenAt?: string | null } =>
      device !== null &&
      device !== undefined &&
      typeof device === 'object' &&
      'id' in device &&
      typeof device.id === 'string',
  )
  if (validDevices.length === 0) return null
  const selected = await choose({
    message: '选择要撤销的设备',
    options: validDevices.map((device) => ({
      value: device.id,
      label: device.id,
      hint: device.lastSeenAt ? `最近活动 ${device.lastSeenAt}` : undefined,
    })),
    input: io.stdin,
    output: io.stdout,
  })
  return isCancel(selected) ? null : selected
}

export function parseOwnerCliCommand(args: string[]): OwnerCliCommand {
  const key = args.join(' ')
  switch (key) {
    case 'auth status':
      return { kind: 'auth-status' }
    case 'bootstrap rotate':
      return { kind: 'bootstrap-rotate' }
    case 'bootstrap recover':
      return { kind: 'bootstrap-recover' }
    case 'auth recovery rotate':
      return { kind: 'recovery-rotate' }
    case 'auth sessions revoke-all':
      return { kind: 'sessions-revoke-all' }
    case 'devices list':
      return { kind: 'devices-list' }
    case 'devices revoke-all':
      return { kind: 'devices-revoke-all' }
    case 'owner-code show':
      return { kind: 'owner-code-show' }
    case 'owner-code rotate':
      return { kind: 'owner-code-rotate' }
    case 'trust reset':
      return { kind: 'trust-reset' }
    default:
      break
  }
  if (args[0] === 'devices' && args[1] === 'revoke' && args.length === 3) {
    const deviceId = args[2]
    if (!deviceId || !/^[A-Za-z0-9._:-]{1,128}$/u.test(deviceId))
      throw new Error('Invalid device id.')
    return { kind: 'devices-revoke', deviceId }
  }
  throw new Error(OWNER_CLI_USAGE)
}

function recoveryCodesFrom(value: unknown): string[] | null {
  if (value === null || typeof value !== 'object' || !('recoveryCodes' in value)) return null
  const codes = value.recoveryCodes
  if (!Array.isArray(codes) || !codes.every((code) => typeof code === 'string')) return null
  return codes
}

export async function runOwnerCliCommand(
  command: OwnerCliCommand,
  services: {
    localManagement: {
      authStatus(): Promise<unknown>
      bootstrapRotate(): Promise<unknown>
      bootstrapRecover(): Promise<unknown>
      rotateRecoveryCodes(): Promise<unknown>
      revokeAllSessions(): Promise<unknown>
      listDevices(): Promise<unknown>
      revokeAllDevices(): Promise<unknown>
      revokeDevice(deviceId: string): Promise<unknown>
      ownerCodeShow(): Promise<unknown>
      ownerCodeRotate(): Promise<unknown>
      trustReset(): Promise<unknown>
    }
  },
  io: Pick<typeof process, 'stdout' | 'stderr' | 'stdin'> = process,
  prompts: {
    confirm(message: string): Promise<boolean | symbol>
  } = {
    confirm: (message) => clackConfirm({ message, input: io.stdin, output: io.stdout }),
  },
) {
  const interactive = io.stdin.isTTY && io.stdout.isTTY
  const confirm = async (message: string) => {
    if (!interactive) throw new Error('This command requires an interactive terminal.')
    const result = await prompts.confirm(message)
    if (isCancel(result)) {
      cancel('No changes made.', { output: io.stdout })
      return false
    }
    return result
  }
  const print = (value: unknown) => {
    const formatted = JSON.stringify(value, null, 2)
    if (interactive) note(formatted, 'Result', { output: io.stdout })
    else io.stdout.write(`${formatted}\n`)
  }
  const run = async <T>(message: string, action: () => Promise<T>) => {
    if (!interactive) return action()
    const progress = spinner({ output: io.stdout })
    progress.start(message)
    try {
      const result = await action()
      progress.stop('Done')
      return result
    } catch (error) {
      progress.error('Failed')
      throw error
    }
  }
  switch (command.kind) {
    case 'auth-status':
      print(
        await run('Reading Owner authentication status', () =>
          services.localManagement.authStatus(),
        ),
      )
      break
    case 'bootstrap-rotate':
      if (
        await confirm(
          'Generate a new five-minute first-session URL? The previous one will stop working.',
        )
      )
        print(
          await run('Generating first-session URL', () =>
            services.localManagement.bootstrapRotate(),
          ),
        )
      break
    case 'bootstrap-recover':
      if (await confirm('Revoke all remote sessions and issue a new first-session URL?'))
        print(
          await run('Recovering remote access', () => services.localManagement.bootstrapRecover()),
        )
      break
    case 'recovery-rotate': {
      if (!(await confirm('Rotate recovery codes? Existing unused codes will stop working.'))) break
      const result = await run('Rotating recovery codes', () =>
        services.localManagement.rotateRecoveryCodes(),
      )
      if (interactive)
        log.warn('Save these recovery codes now. They will not be shown again.', {
          output: io.stdout,
        })
      else io.stderr.write('Save these recovery codes now. They will not be shown again.\n')
      const recoveryCodes = recoveryCodesFrom(result)
      if (recoveryCodes) io.stdout.write(`${recoveryCodes.join('\n')}\n`)
      else throw new Error('Recovery rotation did not return recovery codes.')
      break
    }
    case 'sessions-revoke-all':
      if (await confirm('Revoke every Owner session?'))
        print(
          await run('Revoking Owner sessions', () => services.localManagement.revokeAllSessions()),
        )
      break
    case 'devices-list':
      print(await run('Loading remote devices', () => services.localManagement.listDevices()))
      break
    case 'devices-revoke':
      if (await confirm(`Revoke remote device ${command.deviceId}?`))
        print(
          await run('Revoking remote device', () =>
            services.localManagement.revokeDevice(command.deviceId),
          ),
        )
      break
    case 'devices-revoke-all':
      if (await confirm('Revoke every remote device?'))
        print(
          await run('Revoking all remote devices', () =>
            services.localManagement.revokeAllDevices(),
          ),
        )
      break
    case 'owner-code-show':
      print(
        await run('Loading Owner connection code', () => services.localManagement.ownerCodeShow()),
      )
      break
    case 'owner-code-rotate':
      if (await confirm('Rotate the Owner connection code?'))
        print(
          await run('Rotating Owner connection code', () =>
            services.localManagement.ownerCodeRotate(),
          ),
        )
      break
    case 'trust-reset':
      if (await confirm('Reset remote trust and disconnect every remote device?'))
        print(await run('Resetting remote trust', () => services.localManagement.trustReset()))
      break
  }
}
