import process from 'node:process'

export type OwnerCliCommand =
  | { kind: 'auth-status' }
  | { kind: 'totp-reset' }
  | { kind: 'recovery-rotate' }
  | { kind: 'sessions-revoke-all' }
  | { kind: 'devices-list' }
  | { kind: 'devices-revoke'; deviceId: string }
  | { kind: 'devices-revoke-all' }
  | { kind: 'owner-code-show' }
  | { kind: 'owner-code-rotate' }
  | { kind: 'trust-reset' }

export function parseOwnerCliCommand(args: string[]): OwnerCliCommand {
  const key = args.join(' ')
  switch (key) {
    case 'auth status':
      return { kind: 'auth-status' }
    case 'auth totp reset':
      return { kind: 'totp-reset' }
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
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(args[2]!)) throw new Error('Invalid device id.')
    return { kind: 'devices-revoke', deviceId: args[2]! }
  }
  throw new Error(
    'Usage: codex-web-owner <auth status|auth totp reset|auth recovery rotate|auth sessions revoke-all|devices list|devices revoke <device-id>|devices revoke-all|owner-code show|owner-code rotate|trust reset>',
  )
}

export async function runOwnerCliCommand(
  command: OwnerCliCommand,
  services: {
    localManagement: {
      authStatus(): Promise<unknown>
      resetTotp(password: string): Promise<unknown>
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
) {
  const confirm = async (message: string) => {
    if (!io.stdin.isTTY) throw new Error('This command requires an interactive terminal.')
    io.stdout.write(`${message} Type 'yes' to continue: `)
    const { createInterface } = await import('node:readline/promises')
    const readline = createInterface({ input: io.stdin, output: io.stdout })
    try {
      return (await readline.question('')).trim() === 'yes'
    } finally {
      readline.close()
    }
  }
  const print = (value: unknown) => io.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  const readPassword = async () => {
    if (!io.stdin.isTTY || typeof io.stdin.setRawMode !== 'function')
      throw new Error('TOTP reset requires an interactive terminal.')
    io.stderr.write('Owner password: ')
    const stdin = io.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    return await new Promise<string>((resolve, reject) => {
      let value = ''
      const finish = (error?: Error) => {
        stdin.off('data', onData)
        stdin.setRawMode(wasRaw)
        stdin.pause()
        io.stderr.write('\n')
        if (error) reject(error)
        else if (value.length === 0) reject(new Error('Owner password cannot be empty.'))
        else resolve(value)
      }
      const decoder = new TextDecoder()
      const onData = (chunk: Buffer) => {
        for (const character of decoder.decode(chunk, { stream: true })) {
          if (character === '\u0003') return finish(new Error('Password entry cancelled.'))
          if (character === '\r' || character === '\n') return finish()
          if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
          else value += character
        }
      }
      stdin.on('data', onData)
    })
  }

  switch (command.kind) {
    case 'auth-status':
      print(await services.localManagement.authStatus())
      break
    case 'totp-reset':
      if (await confirm('Reset Owner TOTP? All existing authenticator codes will stop working.')) {
        const password = await readPassword()
        print(await services.localManagement.resetTotp(password))
      }
      break
    case 'recovery-rotate': {
      const result = await services.localManagement.rotateRecoveryCodes()
      io.stderr.write('Save these recovery codes now. They will not be shown again.\n')
      print(result)
      break
    }
    case 'sessions-revoke-all':
      if (await confirm('Revoke every Owner session?'))
        print(await services.localManagement.revokeAllSessions())
      break
    case 'devices-list':
      print(await services.localManagement.listDevices())
      break
    case 'devices-revoke':
      if (await confirm(`Revoke remote device ${command.deviceId}?`))
        print(await services.localManagement.revokeDevice(command.deviceId))
      break
    case 'devices-revoke-all':
      if (await confirm('Revoke every remote device?'))
        print(await services.localManagement.revokeAllDevices())
      break
    case 'owner-code-show':
      print(await services.localManagement.ownerCodeShow())
      break
    case 'owner-code-rotate':
      if (await confirm('Rotate the Owner connection code?'))
        print(await services.localManagement.ownerCodeRotate())
      break
    case 'trust-reset':
      if (await confirm('Reset remote trust and disconnect every remote device?'))
        print(await services.localManagement.trustReset())
      break
  }
}
