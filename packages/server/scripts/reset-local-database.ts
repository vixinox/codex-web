import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { loadServerConfig } from '../src/config.js'
import { acquireOwnerInstanceLock } from '../src/owner/instance-lock.js'
import { resetOwnerDatabase } from '../src/database-reset.js'

const config = loadServerConfig()
const lock = await acquireOwnerInstanceLock(config.dataRoot)
try {
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    const confirmation = await terminal.question(
      'Press Enter to permanently reset Owner control-plane data (or Ctrl+C to cancel): ',
    )
    if (confirmation !== '')
      throw new Error('Please press Enter without typing anything; no data was changed.')
  } finally {
    terminal.close()
  }
  await resetOwnerDatabase(config)
  console.log('Owner database reset. Codex Home history and Owner node identity were preserved.')
} finally {
  await lock.release()
}
