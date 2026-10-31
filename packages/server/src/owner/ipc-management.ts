import type { OwnerApplicationServices } from './application-services.js'
import type { OwnerIpcDispatcher } from './ipc.js'

/** Commands accepted by the local CLI while the Owner process is running. */
export const OWNER_IPC_MANAGEMENT_COMMANDS: ReadonlySet<string> = new Set([
  'owner.ready',
  'auth.status',
  'enrollment.issue',
  'enrollment.recover',
  'sessions.revoke-all',
  'devices.list',
  'devices.revoke',
  'devices.revoke-all',
  'devices.revoke-all-sessions',
  'trust.reset',
])

/**
 * Exposes the narrow local-management surface to IPC. This intentionally does
 * not forward arbitrary RPC names or parameters to the Owner method registry.
 */
export function createOwnerIpcManagementDispatcher(
  services: Pick<OwnerApplicationServices, 'localManagement'>,
): OwnerIpcDispatcher {
  return async (command, params) => {
    const management = services.localManagement
    switch (command) {
      case 'owner.ready':
        return { ready: true }
      case 'auth.status':
        return management.authStatus()
      case 'enrollment.issue':
        return management.enrollmentIssue()
      case 'enrollment.recover':
        return management.enrollmentRecover()
      case 'sessions.revoke-all':
        return management.revokeAllSessions()
      case 'devices.list':
        return management.listDevices()
      case 'devices.revoke':
        return management.revokeDevice(readDeviceId(params))
      case 'devices.revoke-all':
        return management.revokeAllDevices()
      case 'devices.revoke-all-sessions':
        return management.revokeAllSessions()
      case 'trust.reset':
        return management.trustReset()
      default:
        throw new Error('COMMAND_NOT_ALLOWED')
    }
  }
}

function readDeviceId(params: unknown) {
  if (
    params === null ||
    typeof params !== 'object' ||
    Array.isArray(params) ||
    Object.keys(params).length !== 1 ||
    !('deviceId' in params) ||
    typeof params.deviceId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(params.deviceId)
  )
    throw new Error('INVALID_DEVICE_ID')
  return params.deviceId
}
