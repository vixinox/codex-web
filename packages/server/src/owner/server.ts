import 'dotenv/config'

import { createAuth } from '../auth.js'
import { loadServerConfig } from '../config.js'
import { CodexManager } from '../codex/manager.js'
import { SqliteEventStore } from '../codex/event-store.js'
import { CodexRuntimeManager } from '../codex/runtime-manager.js'
import { createDatabase } from '../database.js'
import { log, safeError } from '../logger.js'
import { createWorkspaceService } from '../workspace.js'
import { OwnerConnector } from '../remote/connector.js'
import { RemoteTrustStore } from '../remote/trust-store.js'
import { buildOwnerServer } from './app.js'

const config = loadServerConfig()
const { db, driver } = createDatabase(config)
let remote: OwnerConnector | undefined

try {
  driver.prepare('SELECT 1').get()
  const workspace = createWorkspaceService(config, db)
  const runtime = new CodexRuntimeManager(config)
  await runtime.ensureRuntime()
  const codex = new CodexManager(config, workspace, undefined, runtime)
  const eventStore = new SqliteEventStore(db)
  codex.events.attachStore(eventStore)
  await codex.events.restoreFrom(eventStore)
  await eventStore.retainPerThread()
  const connector = new OwnerConnector(config, new RemoteTrustStore(config.dataRoot))
  remote = connector
  const app = await buildOwnerServer(config, {
    auth: createAuth(config, db),
    workspace,
    codex,
    remote: connector,
  })
  app.addHook('onClose', async () => {
    await connector.stop()
    await codex.events.flush()
    await codex.shutdown()
    driver.close()
  })
  await connector.start()
  await app.listen({ host: config.host, port: config.port })
  log.success(`Owner server listening at http://${config.host}:${config.port}`)
} catch (error) {
  log.error(`Owner server failed to start: ${safeError(error)}`)
  try {
    await remote?.stop()
  } catch {
    // Relay cleanup must not mask the startup failure.
  }
  try {
    driver.close()
  } catch {
    // Database may have failed before opening completely.
  }
  process.exit(1)
}
