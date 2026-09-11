import 'dotenv/config'

import { loadServerConfig } from '../config.js'
import { CodexRuntimeManager } from '../codex/runtime-manager.js'
import { createDatabase } from '../database.js'
import { GuestCodexManager } from '../guest-manager.js'
import { GuestService } from '../guest-service.js'
import { log, safeError } from '../logger.js'
import { buildGuestServer } from './app.js'
import { startGuestRuntime } from './startup.js'
import { createAuth } from '../auth.js'

const config = loadServerConfig('guest')
if (!config.guest) throw new Error('Guest runtime configuration is required')
const { db, pool } = createDatabase(config)

try {
  await pool.query('SELECT 1')
  const runtime = new CodexRuntimeManager(config)
  const guestCodex = new GuestCodexManager(config, runtime)
  const guest = new GuestService(db, config, guestCodex)
  const auth = createAuth(config, db)
  guestCodex.setMessageHandler((message) => guest.ingest(message))
  await startGuestRuntime(runtime, () => guestCodex.start())
  await guest.recover()
  const app = await buildGuestServer(config, guest, auth, db)
  app.addHook('onClose', async () => {
    await guestCodex.stop()
    await pool.end()
  })
  await app.listen({ host: config.host, port: config.port })
  log.success(`Guest server listening at http://${config.host}:${config.port}`)
} catch (error) {
  log.error(`Guest server failed to start: ${safeError(error)}`)
  await pool.end().catch(() => undefined)
  process.exit(1)
}
