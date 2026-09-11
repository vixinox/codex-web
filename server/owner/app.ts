import type { ServerConfig } from '../config.js'
import { SkillHandleStore } from '../skills.js'
import { createHttpServer } from '../http/server-base.js'
import type { AppDependencies } from '../http/types.js'
import { registerAuthRoutes } from '../http/auth-routes.js'
import { registerConfigurationRoutes } from '../http/configuration-routes.js'
import { registerCredentialRoutes } from '../http/credentials-routes.js'
import { registerEventRoutes } from '../http/event-routes.js'
import { registerHealthRoutes } from '../http/health-routes.js'
import { registerProjectRoutes } from '../http/projects-routes.js'
import { registerSkillRoutes } from '../http/skills-routes.js'
import { registerThreadRoutes } from '../http/thread-routes.js'

export async function buildOwnerServer(config: ServerConfig, dependencies: AppDependencies) {
  const app = await createHttpServer()
  const context = { config, dependencies }
  const skillHandles = new SkillHandleStore()
  await registerHealthRoutes(app, context)
  await registerAuthRoutes(app, context)
  await registerConfigurationRoutes(app, context)
  await registerProjectRoutes(app, context)
  await registerCredentialRoutes(app, context)
  await registerSkillRoutes(app, context, skillHandles)
  await registerThreadRoutes(app, context, skillHandles)
  await registerEventRoutes(app, context)
  return app
}
