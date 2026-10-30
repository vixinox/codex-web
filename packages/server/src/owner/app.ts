import type { ServerConfig } from '../config.js'
import { createHttpServer } from '../http/server-base.js'
import type { AppDependencies } from '../http/types.js'
import { createOwnerApplicationServices } from './application-services.js'
import { registerHealthRoutes } from '../http/health-routes.js'
import { registerOwnerWebSocket } from './websocket.js'
import {
  OWNER_IPC_MANAGEMENT_COMMANDS,
  createOwnerIpcManagementDispatcher,
} from './ipc-management.js'
import { startOwnerIpcServer } from './ipc.js'

export async function buildOwnerServer(config: ServerConfig, dependencies: AppDependencies) {
  const app = await createHttpServer({
    trustedOrigins: config.trustedOrigins,
    enforceOriginChecks: config.enforceOriginChecks,
  })
  const context = { config, dependencies }
  const services = createOwnerApplicationServices(dependencies, {
    trustedOrigins: config.trustedOrigins,
    requireDangerousAccessConfirmation: config.requireDangerousAccessConfirmation,
    remoteRelayUrl: config.remoteRelayUrl,
    appOrigin: config.appOrigin,
    rpId: config.rpId,
  })
  const ipc = await startOwnerIpcServer(
    config.dataRoot,
    createOwnerIpcManagementDispatcher(services),
    OWNER_IPC_MANAGEMENT_COMMANDS,
  )
  app.addHook('onClose', async () => ipc.close())
  app.addHook('onListen', async () => ipc.markReady())
  await registerHealthRoutes(app, context)
  await registerOwnerWebSocket(app, { ...context, services })
  return Object.assign(app, { ownerServices: services })
}
