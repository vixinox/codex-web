import type { ServerConfig } from '../config.js'
import { createHttpServer } from '../http/server-base.js'
import type { AppDependencies } from '../http/types.js'
import { createOwnerApplicationServices } from './application-services.js'
import { registerAuthRoutes } from '../http/auth-routes.js'
import { registerHealthRoutes } from '../http/health-routes.js'
import { registerRemoteRoutes } from '../http/remote-routes.js'
import { registerOwnerWebSocket } from './websocket.js'

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
  })
  await registerHealthRoutes(app, context)
  await registerOwnerWebSocket(app, { ...context, services })
  await registerAuthRoutes(app, context)
  await registerRemoteRoutes(app, context, services)
  return app
}
