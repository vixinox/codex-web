import type { AppDependencies } from '../http/types.js'
import { createOwnerApplicationServices } from './application-services.js'
import type { OwnerApplicationServices } from './application-services.js'
import { createOwnerMethodRegistry } from './methods.js'
import type { OwnerAdmission, OwnerMethodRegistry, OwnerTransport } from './session-runtime.js'

export type OwnerApplicationRuntime = {
  registry: OwnerMethodRegistry
  resumeSession: (token: string, transport: OwnerTransport) => Promise<OwnerAdmission | null>
  isDeviceAuthorized: (deviceId: string) => Promise<boolean>
  localManagement: OwnerApplicationServices['localManagement']
}

export function createOwnerApplicationRuntime(
  dependencies: AppDependencies,
  options: Parameters<typeof createOwnerApplicationServices>[1],
): OwnerApplicationRuntime {
  const services = createOwnerApplicationServices(dependencies, options)
  return {
    registry: createOwnerMethodRegistry(services),
    resumeSession: (token, transport) => services.resumeSession(token, transport),
    isDeviceAuthorized: (deviceId) => services.isDeviceAuthorized(deviceId),
    localManagement: services.localManagement,
  }
}
