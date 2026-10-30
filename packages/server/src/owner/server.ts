import 'dotenv/config'

import { loadServerConfig } from '../config.js'
import { CodexManager } from '../codex/manager.js'
import { SqliteEventStore } from '../codex/event-store.js'
import { CodexRuntimeManager } from '../codex/runtime-manager.js'
import { createDatabase, prepareOwnerDatabase } from '../database.js'
import { log, safeError } from '../logger.js'
import { createWorkspaceService } from '../workspace.js'
import { OwnerConnector } from '../remote/connector.js'
import { RemoteTrustStore } from '../remote/trust-store.js'
import { buildOwnerServer } from './app.js'
import { acquireOwnerInstanceLock } from './instance-lock.js'
import { ensureOwnerInitialized } from './owner-initialization.js'
import { renderTerminal } from '@vincentkoc/qrcode-tui'

const config = loadServerConfig()
let db: ReturnType<typeof createDatabase>['db']
let driver: ReturnType<typeof createDatabase>['driver'] | undefined
let remote: OwnerConnector | undefined
let instanceLock: Awaited<ReturnType<typeof acquireOwnerInstanceLock>> | undefined

try {
  instanceLock = await acquireOwnerInstanceLock(config.dataRoot)
  prepareOwnerDatabase(config)
  ;({ db, driver } = createDatabase(config))
  driver.prepare('SELECT 1').get()
  const workspace = createWorkspaceService(config, db)
  const ownerId = await ensureOwnerInitialized(workspace)
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
    ownerId,
    database: db,
    workspace,
    codex,
    remote: connector,
  })
  app.addHook('onClose', async () => {
    try {
      await connector.stop()
    } finally {
      try {
        await codex.events.flush()
      } finally {
        try {
          await codex.shutdown()
        } finally {
          try {
            driver?.close()
          } finally {
            await instanceLock?.release()
          }
        }
      }
    }
  })
  await connector.start()
  await app.listen({ host: config.host, port: config.port })
  log.success(`Owner server listening at http://${config.host}:${config.port}`)
  const bootstrap = await app.ownerServices.startupBootstrapPayload()
  if (bootstrap) {
    const origin = bootstrap.appOrigin ?? config.appOrigin ?? 'http://localhost:5173'
    const url = `${origin}/app/first-session?ref=${encodeURIComponent(bootstrap.reference)}`
    process.stdout.write(`First remote session (expires at ${bootstrap.expiresAt}):\n${url}\n`)
    if (process.stdout.isTTY) process.stdout.write(await renderTerminal(url, { small: true }))
  }
} catch (error) {
  log.error(`Owner server failed to start: ${safeError(error)}`)
  try {
    await remote?.stop()
  } catch {
    // Relay cleanup must not mask the startup failure.
  }
  try {
    driver?.close()
  } catch {
    // Database may have failed before opening completely.
  }
  await instanceLock?.release().catch(() => undefined)
  process.exit(1)
}
