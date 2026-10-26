import 'dotenv/config'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { loadServerConfig } from '../src/config.js'

const config = loadServerConfig()
const databasePath = path.join(config.dataRoot, 'owner.sqlite')
await rm(databasePath, { force: true })
console.log(`Removed local SQLite database at ${databasePath}.`)
