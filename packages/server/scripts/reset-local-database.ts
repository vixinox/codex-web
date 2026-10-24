import 'dotenv/config'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { loadServerConfig } from '../src/config.js'

const config = loadServerConfig()
await rm(path.join(config.dataRoot, 'owner.sqlite'), { force: true })
console.log(`Removed local SQLite database at ${path.join(config.dataRoot, 'owner.sqlite')}.`)
