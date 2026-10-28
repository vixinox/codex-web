import { createAuth } from '../auth.js'
import type { ServerConfig } from '../config.js'
import { CodexManager } from '../codex/manager.js'
import { CodexRuntimeManager } from '../codex/runtime-manager.js'
import { createDatabase } from '../database.js'
import { OwnerConnector } from '../remote/connector.js'
import { RemoteTrustStore } from '../remote/trust-store.js'
import { createWorkspaceService } from '../workspace.js'
import { createOwnerApplicationServices } from './application-services.js'
import { acquireOwnerInstanceLock } from './instance-lock.js'
import { createOwnerMethodRegistry } from './methods.js'

export async function createOwnerCliRuntime(
  config: ServerConfig,
  useRemoteServices = false,
  connectRelay = false,
) {
  const lock = await acquireOwnerInstanceLock(config.dataRoot)
  let driver: ReturnType<typeof createDatabase>['driver'] | undefined
  let remote: OwnerConnector | undefined
  let codex: CodexManager | undefined

  try {
    const database = createDatabase(config)
    driver = database.driver
    const workspace = createWorkspaceService(config, database.db)
    const runtime = new CodexRuntimeManager(config)
    codex = new CodexManager(config, workspace, undefined, runtime)
    const connector = useRemoteServices
      ? new OwnerConnector(config, new RemoteTrustStore(config.dataRoot))
      : undefined
    remote = connector
    const auth = createAuth(config, database.db)
    const localAuth = createAuth(config, database.db, { allowPasswordlessTwoFactor: true })
    const services = createOwnerApplicationServices(
      { auth, localAuth, workspace, codex, remote, authSecret: config.authSecret },
      {
        trustedOrigins: config.trustedOrigins,
        requireDangerousAccessConfirmation: config.requireDangerousAccessConfirmation,
        remoteRelayUrl: config.remoteRelayUrl,
      },
    )
    if (connector) {
      connector.configureRemoteSessions(createOwnerMethodRegistry(services), (token, transport) =>
        services.resumeSession(token, transport),
      )
      if (connectRelay) {
        await connector.start()
        await connector.waitUntilConnected()
      }
    }

    let closed = false
    return {
      services,
      async close() {
        if (closed) return
        closed = true
        try {
          await remote?.stop()
        } finally {
          try {
            await codex?.shutdown()
          } finally {
            try {
              driver?.close()
            } finally {
              await lock.release()
            }
          }
        }
      },
    }
  } catch (error) {
    await remote?.stop().catch(() => undefined)
    await codex?.shutdown().catch(() => undefined)
    try {
      driver?.close()
    } finally {
      await lock.release()
    }
    throw error
  }
}
