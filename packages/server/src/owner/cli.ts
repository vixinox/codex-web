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
  | { kind: 'enrollment-issue' }
  | { kind: 'devices-list' }
  | { kind: 'devices-revoke'; deviceId: string }
  | { kind: 'devices-revoke-all' }

export type OwnerCliMenuAction =
  | OwnerCliCommand
  | { kind: 'devices-revoke-menu' }
  | { kind: 'menu-exit' }

export const OWNER_CLI_USAGE =
  'Usage: codex-web-owner <enrollment issue|devices list|devices revoke <device-id>|devices revoke-all>'

const MENU_LABELS: Record<OwnerCliCommand['kind'], string> = {
  'enrollment-issue': '生成登录链接',
  'devices-list': '设备 · 列出已登记设备',
  'devices-revoke': '设备 · 移除设备',
  'devices-revoke-all': '设备 · 移除所有远程设备',
}

const MENU_ACTIONS: Array<{ kind: OwnerCliMenuAction['kind']; label: string }> = [
  { kind: 'enrollment-issue', label: MENU_LABELS['enrollment-issue'] },
  { kind: 'devices-list', label: MENU_LABELS['devices-list'] },
  { kind: 'devices-revoke-menu', label: MENU_LABELS['devices-revoke'] },
  { kind: 'devices-revoke-all', label: MENU_LABELS['devices-revoke-all'] },
  { kind: 'menu-exit', label: '退出' },
]

const COMMAND_ACTIONS: OwnerCliCommand[] = [
  { kind: 'enrollment-issue' },
  { kind: 'devices-list' },
  { kind: 'devices-revoke-all' },
]

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
    message: '设备连接',
    options: MENU_ACTIONS.map((action) => ({
      value: action.kind,
      label: action.label,
    })),
    input: io.stdin,
    output: io.stdout,
    maxItems: 7,
  })
  if (isCancel(selected) || selected === 'menu-exit') return { kind: 'menu-exit' }
  if (selected === 'devices-revoke-menu') return { kind: 'devices-revoke-menu' }
  const command = COMMAND_ACTIONS.find((action) => action.kind === selected)
  if (command) return command
  return { kind: 'menu-exit' }
}

export async function runOwnerCliMenu(dependencies: {
  connectClient(): Promise<Parameters<typeof runOwnerCliCommand>[1]>
  selectAction(): Promise<OwnerCliMenuAction>
  selectDevice(devices: unknown[]): Promise<string | null>
  runCommand(
    command: OwnerCliCommand,
    services: Parameters<typeof runOwnerCliCommand>[1],
  ): Promise<void>
  reportInfo(message: string): void
  reportError(error: unknown): void
}) {
  /* oxlint-disable no-await-in-loop -- Each selected action finishes before the next prompt. */
  while (true) {
    const action = await dependencies.selectAction()
    if (action.kind === 'menu-exit') return
    try {
      const client = await dependencies.connectClient()
      if (action.kind === 'devices-revoke-menu') {
        const devices = await client.localManagement.listDevices()
        if (!Array.isArray(devices)) throw new Error('Remote device list is invalid.')
        if (devices.length === 0) {
          dependencies.reportInfo('No registered remote devices.')
          continue
        }
        const deviceId = await dependencies.selectDevice(devices)
        if (deviceId) await dependencies.runCommand({ kind: 'devices-revoke', deviceId }, client)
      } else {
        await dependencies.runCommand(action, client)
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
    case 'enrollment issue':
      return { kind: 'enrollment-issue' }
    case 'devices list':
      return { kind: 'devices-list' }
    case 'devices revoke-all':
      return { kind: 'devices-revoke-all' }
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
  io.stdout.write(`One-time login URL (expires at ${value.expiresAt}):\n${url}\n${qr}\n`)
}

export async function runOwnerCliCommand(
  command: OwnerCliCommand,
  services: {
    localManagement: {
      enrollmentIssue(): Promise<unknown>
      listDevices(): Promise<unknown>
      revokeAllDevices(): Promise<unknown>
      revokeDevice(deviceId: string): Promise<unknown>
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
    case 'enrollment-issue':
      await printEnrollmentIssue(
        await run('Generating login link', () => services.localManagement.enrollmentIssue()),
        io,
      )
      break
    case 'devices-list':
      print(await run('Loading remote devices', () => services.localManagement.listDevices()))
      break
    case 'devices-revoke':
      if (await confirm(`Remove remote device ${command.deviceId}?`))
        print(
          await run('Removing device', () =>
            services.localManagement.revokeDevice(command.deviceId),
          ),
        )
      break
    case 'devices-revoke-all':
      if (await confirm('Remove all remote devices? Sign in again from this machine afterwards.'))
        print(
          await run('Removing all remote devices', () =>
            services.localManagement.revokeAllDevices(),
          ),
        )
      break
  }
}
