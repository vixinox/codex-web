import process from 'node:process'
import { renderTerminal } from '@vincentkoc/qrcode-tui'
import {
  cancel,
  confirm as clackConfirm,
  isCancel,
  note,
  select as clackSelect,
  spinner,
} from '@clack/prompts'

export type OwnerCliCommand =
  | { kind: 'auth-status' }
  | { kind: 'enrollment-issue' }
  | { kind: 'enrollment-recover' }
  | { kind: 'sessions-revoke-all' }
  | { kind: 'devices-list' }
  | { kind: 'devices-revoke'; deviceId: string }
  | { kind: 'devices-revoke-all' }
  | { kind: 'trust-reset' }

export type OwnerCliMenuAction =
  | OwnerCliCommand
  | { kind: 'devices-revoke-menu' }
  | { kind: 'menu-exit' }

export const OWNER_CLI_USAGE =
  'Usage: codex-web-owner <auth status|enrollment issue|enrollment recover|auth sessions revoke-all|devices list|devices revoke <device-id>|devices revoke-all|trust reset>'

const MENU_LABELS: Record<OwnerCliCommand['kind'], string> = {
  'auth-status': '认证 · 查看状态',
  'enrollment-issue': '远程接入 · 生成设备邀请',
  'enrollment-recover': '远程接入 · 本机恢复并生成设备邀请',
  'sessions-revoke-all': '会话 · 撤销所有 Owner 会话',
  'devices-list': '设备 · 列出已登记设备',
  'devices-revoke': '设备 · 撤销指定设备',
  'devices-revoke-all': '设备 · 撤销所有设备',
  'trust-reset': '信任 · 重置远程信任',
}

const MENU_ACTIONS: Array<{ kind: OwnerCliMenuAction['kind']; label: string }> = [
  { kind: 'auth-status', label: MENU_LABELS['auth-status'] },
  { kind: 'enrollment-issue', label: MENU_LABELS['enrollment-issue'] },
  { kind: 'enrollment-recover', label: MENU_LABELS['enrollment-recover'] },
  { kind: 'sessions-revoke-all', label: MENU_LABELS['sessions-revoke-all'] },
  { kind: 'devices-list', label: MENU_LABELS['devices-list'] },
  { kind: 'devices-revoke-menu', label: MENU_LABELS['devices-revoke'] },
  { kind: 'devices-revoke-all', label: MENU_LABELS['devices-revoke-all'] },
  { kind: 'trust-reset', label: MENU_LABELS['trust-reset'] },
  { kind: 'menu-exit', label: '退出' },
]

const COMMAND_ACTIONS: OwnerCliCommand[] = [
  { kind: 'auth-status' },
  { kind: 'enrollment-issue' },
  { kind: 'enrollment-recover' },
  { kind: 'sessions-revoke-all' },
  { kind: 'devices-list' },
  { kind: 'devices-revoke-all' },
  { kind: 'trust-reset' },
]

export function requiresRemoteServices(command: OwnerCliCommand) {
  return [
    'devices-list',
    'devices-revoke',
    'devices-revoke-all',
    'enrollment-issue',
    'enrollment-recover',
    'trust-reset',
  ].includes(command.kind)
}

export function requiresRelayConnection(command: OwnerCliCommand) {
  return command.kind === 'enrollment-issue' || command.kind === 'enrollment-recover'
}

export const OWNER_CLI_IPC_COMMANDS: Readonly<Record<OwnerCliCommand['kind'], string>> = {
  'auth-status': 'auth.status',
  'enrollment-issue': 'enrollment.issue',
  'enrollment-recover': 'enrollment.recover',
  'sessions-revoke-all': 'sessions.revoke-all',
  'devices-list': 'devices.list',
  'devices-revoke': 'devices.revoke',
  'devices-revoke-all': 'devices.revoke-all',
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
    case 'enrollment issue':
      return { kind: 'enrollment-issue' }
    case 'enrollment recover':
      return { kind: 'enrollment-recover' }
    case 'auth sessions revoke-all':
      return { kind: 'sessions-revoke-all' }
    case 'devices list':
      return { kind: 'devices-list' }
    case 'devices revoke-all':
      return { kind: 'devices-revoke-all' }
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

type EnrollmentIssueResult = {
  reference: string
  expiresAt: string
  appOrigin?: string
}

function isEnrollmentIssueResult(value: unknown): value is EnrollmentIssueResult {
  if (value === null || typeof value !== 'object') return false
  return (
    'reference' in value &&
    typeof value.reference === 'string' &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'string' &&
    (!('appOrigin' in value) ||
      value.appOrigin === undefined ||
      typeof value.appOrigin === 'string')
  )
}

function enrollmentUrl(result: EnrollmentIssueResult) {
  if (!/^[A-Za-z0-9_-]{16,256}$/u.test(result.reference))
    throw new Error('Enrollment reference is invalid.')
  if (!result.appOrigin) throw new Error('App origin is unavailable.')
  let origin: URL
  try {
    origin = new URL(result.appOrigin)
  } catch {
    throw new Error('App origin is invalid.')
  }
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('App origin is invalid.')
  const url = new URL('/app/enroll', origin)
  url.searchParams.set('ref', result.reference)
  return url.toString()
}

async function printEnrollmentIssue(value: unknown, io: Pick<typeof process, 'stdout'>) {
  if (!isEnrollmentIssueResult(value)) throw new Error('Enrollment issue response is invalid.')
  const url = enrollmentUrl(value)
  const qr = await renderTerminal(url, { small: true })
  io.stdout.write(`Enrollment URL (expires at ${value.expiresAt}):\n${url}\n${qr}\n`)
}

export async function runOwnerCliCommand(
  command: OwnerCliCommand,
  services: {
    localManagement: {
      authStatus(): Promise<unknown>
      enrollmentIssue(): Promise<unknown>
      enrollmentRecover(): Promise<unknown>
      revokeAllSessions(): Promise<unknown>
      listDevices(): Promise<unknown>
      revokeAllDevices(): Promise<unknown>
      revokeDevice(deviceId: string): Promise<unknown>
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
    case 'enrollment-issue':
      await printEnrollmentIssue(
        await run('Generating enrollment URL', () => services.localManagement.enrollmentIssue()),
        io,
      )
      break
    case 'enrollment-recover':
      if (await confirm('Reset remote trust and issue a new device enrollment URL?'))
        print(
          await run('Recovering remote access', () => services.localManagement.enrollmentRecover()),
        )
      break
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
    case 'trust-reset':
      if (await confirm('Reset remote trust and disconnect every remote device?'))
        print(await run('Resetting remote trust', () => services.localManagement.trustReset()))
      break
  }
}
