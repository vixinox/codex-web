import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { loadServerConfig } from '../src/config.js'
import { acquireOwnerInstanceLock } from '../src/owner/instance-lock.js'
import { prepareOwnerDatabase } from '../src/database.js'

const config = loadServerConfig()
const lock = await acquireOwnerInstanceLock(config.dataRoot)
try {
  const terminal = createInterface({ input: stdin, output: stdout })
  try {
    const confirmation = await terminal.question('Type RESET OWNER DATABASE to permanently reset Owner control-plane data: ')
    if (confirmation !== 'RESET OWNER DATABASE') throw new Error('Confirmation did not match; no data was changed.')
  } finally {
    terminal.close()
  }
  await rm(path.join(config.dataRoot, 'owner.sqlite'), { force: true })
  prepareOwnerDatabase(config)
  console.log('Owner database reset. Codex Home history and Owner node identity were preserved.')
} finally {
  await lock.release()
}
