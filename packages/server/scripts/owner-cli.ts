import 'dotenv/config'

import process from 'node:process'
import { log } from '@clack/prompts'
import { connectOwnerCli } from '../src/owner/cli-client.js'
import {
  parseOwnerCliInvocation,
  runOwnerCliCommand,
  runOwnerCliMenu,
  selectOwnerCliMenuAction,
  selectOwnerCliDevice,
} from '../src/owner/cli.js'
import { loadServerConfig } from '../src/config.js'

async function main() {
  let invocation
  try {
    invocation = parseOwnerCliInvocation(
      process.argv.slice(2),
      process.stdin.isTTY && process.stdout.isTTY,
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid command'}\n`)
    process.exitCode = 2
    return
  }

  const connectClient = () => connectOwnerCli(loadServerConfig())

  if (invocation.mode === 'menu') {
    await runOwnerCliMenu({
      connectClient,
      selectAction: () => selectOwnerCliMenuAction(),
      selectDevice: (devices) => selectOwnerCliDevice(devices),
      runCommand: runOwnerCliCommand,
      reportInfo(message) {
        log.info(message, { output: process.stdout })
      },
      reportError(error) {
        log.error(error instanceof Error ? error.message : 'Owner management command failed', {
          output: process.stdout,
        })
      },
    })
    return
  }

  const command = invocation.command
  try {
    const client = await connectClient()
    await runOwnerCliCommand(command, client)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner management command failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}

await main()
