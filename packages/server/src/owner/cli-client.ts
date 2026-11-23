import type { ServerConfig } from '../config.js'
import { ownerIpcEndpoint, sendOwnerIpcRequest } from './ipc.js'

/** The CLI never owns an Owner runtime; all management state belongs to the running server. */
export async function connectOwnerCli(config: Pick<ServerConfig, 'dataRoot'>) {
  const endpoint = ownerIpcEndpoint(config.dataRoot)
  try {
    const deadline = Date.now() + 5_000
    while (true) {
      try {
        // Each probe depends on the previous readiness result. Never retry a mutation.
        // eslint-disable-next-line no-await-in-loop
        await sendOwnerIpcRequest(
          endpoint,
          'owner.ready',
          undefined,
          Math.min(1_000, Math.max(1, deadline - Date.now())),
        )
        break
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'OWNER_NOT_READY' ||
          Date.now() >= deadline
        )
          throw error
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())))
      }
    }
  } catch (error) {
    throw new Error(
      'Owner is not running or not ready. Start it with pnpm server, then try again.',
      { cause: error },
    )
  }
  return {
    localManagement: {
      enrollmentIssue: () => sendOwnerIpcRequest(endpoint, 'enrollment.issue'),
      listDevices: () => sendOwnerIpcRequest(endpoint, 'devices.list'),
      revokeDevice: (deviceId: string) =>
        sendOwnerIpcRequest(endpoint, 'devices.revoke', { deviceId }),
      revokeAllDevices: () => sendOwnerIpcRequest(endpoint, 'devices.revoke-all'),
    },
  }
}
