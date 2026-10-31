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
import { ownerIpcEndpoint, retryOwnerIpc, sendOwnerIpcRequest } from './ipc.js'
import {
  OWNER_CLI_IPC_COMMANDS,
  requiresRelayConnection,
  requiresRemoteServices,
  type OwnerCliCommand,
} from './cli.js'
import { OwnerInstanceAlreadyRunningError } from './instance-lock.js'

type AdaptiveRuntime = {
  services: {
    localManagement: {
      authStatus(): Promise<unknown>
      enrollmentIssue(): Promise<unknown>
      enrollmentRecover(): Promise<unknown>
      revokeAllSessions(): Promise<unknown>
      listDevices(): Promise<unknown>
      revokeAllDevices(): Promise<unknown>
      revokeDevice(deviceId: string): Promise<unknown>
      trustReset(): Promise<unknown>
    }
  }
  close(): Promise<void>
}

export async function createOwnerCliRuntime(
  config: ServerConfig,
  useRemoteServices = false,
  connectRelay = false,
) {
  const lock = await acquireOwnerInstanceLock(config.dataRoot)
  void connectRelay
  return createOwnerCliRuntimeUnlocked(config, { kind: 'auth-status' }, lock, useRemoteServices)
}

async function createOwnerCliRuntimeUnlocked(
  config: ServerConfig,
  command: OwnerCliCommand,
  lock: Awaited<ReturnType<typeof acquireOwnerInstanceLock>>,
  useRemoteOverride = false,
) {
  let driver: ReturnType<typeof createDatabase>['driver'] | undefined
  let remote: OwnerConnector | undefined
  let codex: CodexManager | undefined

  try {
    const database = createDatabase(config)
    driver = database.driver
    const workspace = createWorkspaceService(config, database.db)
    let ownerId = await workspace.getOnlyOwnerId()
    if (!ownerId) {
      ownerId = crypto.randomUUID()
      await workspace.createOwner(ownerId)
    }
    const runtime = new CodexRuntimeManager(config)
    codex = new CodexManager(config, workspace, undefined, runtime)
    const connector =
      useRemoteOverride || requiresRemoteServices(command)
        ? new OwnerConnector(config, new RemoteTrustStore(config.dataRoot))
        : undefined
    remote = connector
    const services = createOwnerApplicationServices(
      { ownerId, database: database.db, workspace, codex, remote },
      {
        trustedOrigins: config.trustedOrigins,
        requireDangerousAccessConfirmation: config.requireDangerousAccessConfirmation,
        remoteRelayUrl: config.remoteRelayUrl,
        appOrigin: config.appOrigin,
        rpId: config.rpId,
      },
    )
    if (connector) {
      connector.configureRemoteSessions(createOwnerMethodRegistry(services), (token, transport) =>
        services.resumeSession(token, transport),
      )
      if (requiresRelayConnection(command)) {
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

export async function createAdaptiveOwnerCliRuntime(
  config: ServerConfig,
  command: OwnerCliCommand,
): Promise<AdaptiveRuntime> {
  const endpoint = ownerIpcEndpoint(config.dataRoot)
  try {
    await sendOwnerIpcRequest(endpoint, 'owner.ready', undefined, 200)
    return ipcRuntime(endpoint, command)
  } catch {
    let lock: Awaited<ReturnType<typeof acquireOwnerInstanceLock>>
    try {
      lock = await acquireOwnerInstanceLock(config.dataRoot)
    } catch (error) {
      if (!(error instanceof OwnerInstanceAlreadyRunningError)) throw error
      await retryOwnerIpc(() => sendOwnerIpcRequest(endpoint, 'owner.ready', undefined, 1_000))
      return ipcRuntime(endpoint, command)
    }
    return await createOwnerCliRuntimeUnlocked(config, command, lock)
  }
}

function ipcRuntime(endpoint: string, command: OwnerCliCommand) {
  const ipcCommand = OWNER_CLI_IPC_COMMANDS[command.kind]
  const request = () => sendOwnerIpcRequest(endpoint, ipcCommand, commandParams(command))
  const localManagement = {
    authStatus: () => sendOwnerIpcRequest(endpoint, 'auth.status'),
    enrollmentIssue: () => request(),
    enrollmentRecover: () => request(),
    revokeAllSessions: () => request(),
    listDevices: () => request(),
    revokeAllDevices: () => request(),
    revokeDevice: (deviceId: string) =>
      sendOwnerIpcRequest(endpoint, 'devices.revoke', { deviceId }),
    trustReset: () => request(),
  }
  return { services: { localManagement }, async close() {} }
}

function commandParams(command: OwnerCliCommand): unknown {
  return command.kind === 'devices-revoke' ? { deviceId: command.deviceId } : undefined
}
