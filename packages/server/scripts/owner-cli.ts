import 'dotenv/config'

import process from 'node:process'
import { createOwnerCliRuntime } from '../src/owner/cli-runtime.js'
import { OwnerInstanceAlreadyRunningError } from '../src/owner/instance-lock.js'
import { parseOwnerCliCommand, runOwnerCliCommand } from '../src/owner/cli.js'
import { loadServerConfig } from '../src/config.js'

async function main() {
  let command
  try {
    command = parseOwnerCliCommand(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid command'}\n`)
    process.exitCode = 2
    return
  }

  try {
    const config = loadServerConfig()
    const usesRemote = [
      'devices-list',
      'devices-revoke',
      'devices-revoke-all',
      'owner-code-show',
      'owner-code-rotate',
      'trust-reset',
    ].includes(command.kind)
    const runtime = await createOwnerCliRuntime(
      config,
      usesRemote,
      command.kind === 'owner-code-rotate',
    )
    try {
      await runOwnerCliCommand(command, runtime.services)
    } finally {
      await runtime.close()
    }
  } catch (error) {
    if (error instanceof OwnerInstanceAlreadyRunningError) {
      process.stderr.write('Owner is running. Stop Owner before using the local management CLI.\n')
    } else {
      const message = error instanceof Error ? error.message : 'Owner management command failed'
      process.stderr.write(`${message}\n`)
    }
    process.exitCode = 1
  }
}

await main()
