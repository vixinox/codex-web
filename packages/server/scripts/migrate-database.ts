import 'dotenv/config'

import { loadServerConfig } from '../src/config.js'
import { createDatabase } from '../src/database.js'

const config = loadServerConfig()
const database = createDatabase(config)
database.driver.close()
console.log('SQLite database initialized and migrations applied.')
