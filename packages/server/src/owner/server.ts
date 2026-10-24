import 'dotenv/config'

import { createAuth } from '../auth.js'
import { loadServerConfig } from '../config.js'
import { CodexManager } from '../codex/manager.js'
import { PostgresEventStore } from '../codex/event-store.js'
import { CodexRuntimeManager } from '../codex/runtime-manager.js'
import { createDatabase } from '../database.js'
import { log, safeError } from '../logger.js'
import { createWorkspaceService } from '../workspace.js'
import { OwnerConnector } from '../remote/connector.js'
import { RemoteTrustStore } from '../remote/trust-store.js'
import { buildOwnerServer } from './app.js'

const config = loadServerConfig()
const { db, pool } = createDatabase(config)

try {
  await pool.query('SELECT 1')
  const workspace = createWorkspaceService(config, db)
  const runtime = new CodexRuntimeManager(config)
  await runtime.ensureRuntime()
  const codex = new CodexManager(config, workspace, undefined, runtime)
  const eventStore = new PostgresEventStore(db)
  codex.events.attachStore(eventStore)
  await codex.events.restoreFrom(eventStore)
  await eventStore.retainPerThread()
  const remote = new OwnerConnector(config, new RemoteTrustStore(config.dataRoot))
  await remote.start()
  const app = await buildOwnerServer(config, {
    auth: createAuth(config, db),
    workspace,
    codex,
    remote,
  })
  app.addHook('onClose', async () => {
    await remote.stop()
    await codex.events.flush()
    await codex.shutdown()
    await pool.end()
  })
  await app.listen({ host: config.host, port: config.port })
  log.success(`Owner server listening at http://${config.host}:${config.port}`)
} catch (error) {
  log.error(`Owner server failed to start: ${safeError(error)}`)
  await pool.end().catch(() => undefined)
  process.exit(1)
}
