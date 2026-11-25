import type { CodexOwnerPort } from '../codex/owner-port.js'
import type { WorkspaceService } from '../workspace.js'
import type { OwnerConnector } from '../remote/connector.js'
import type { Database } from '../database.js'
import { createThreadDomain } from '../threads/index.js'
import { createDeviceManagement } from './device-management.js'
import { createOwnerAuthDomain } from './auth-domain.js'
import { createOwnerEventServices } from './event-services.js'
import { mapThreadAccessFailure } from './application/validation.js'
import { createWorkspaceOperations } from './application/workspace.js'
import { createCodexOperations } from './application/codex.js'
import { createThreadOperations } from './application/threads.js'
import { createConversationReader } from './application/conversation-read.js'
import { createConversationCommands } from './application/conversation-commands.js'
import { createAuthenticationOperations } from './application/authentication.js'

export type { OwnerEventCursor } from '@codex-web/protocol/owner'

export type OwnerApplicationServiceDependencies = {
  workspace: WorkspaceService & {
    hasOwner?: () => Promise<boolean>
    getOnlyOwnerId: () => Promise<string | null>
  }
  codex: CodexOwnerPort
  remote?: OwnerConnector
  ownerId?: string
  database?: Database
}

export type OwnerApplicationServiceOptions = {
  trustedOrigins: readonly string[]
  remoteRelayUrl?: string
  appOrigin?: string
  rpId?: string
}

export type OwnerApplicationServices = ReturnType<typeof createOwnerApplicationServices>

export function createOwnerApplicationServices(
  dependencies: OwnerApplicationServiceDependencies,
  options: OwnerApplicationServiceOptions,
) {
  const authDomain =
    dependencies.database && dependencies.ownerId && options.appOrigin && options.rpId
      ? createOwnerAuthDomain(
          dependencies.database,
          dependencies.ownerId,
          () => Date.now(),
          async () =>
            dependencies.remote ? (await dependencies.remote.trust.identity()).trustEpoch : 0,
          { origin: options.appOrigin, rpId: options.rpId },
        )
      : undefined
  const devices = createDeviceManagement(
    dependencies.remote,
    authDomain,
    dependencies.ownerId,
    options.appOrigin ?? '',
  )
  const threadDomain = createThreadDomain({
    workspace: dependencies.workspace,
    codex: dependencies.codex,
  })
  const eventServices = createOwnerEventServices({
    events: dependencies.codex.events,
    assertThreadReadable: async (ownerId, threadId) => {
      const access = await threadDomain.access({ userId: ownerId, threadId, mode: 'read' })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    },
  })
  const threads = createThreadOperations({
    workspace: dependencies.workspace,
    codex: dependencies.codex,
    threadDomain,
  })
  return {
    ...createAuthenticationOperations({
      workspace: dependencies.workspace,
      ownerId: dependencies.ownerId,
      remote: dependencies.remote,
      authDomain,
      devices,
      options,
    }),
    ...createWorkspaceOperations({ workspace: dependencies.workspace, codex: dependencies.codex }),
    ...createCodexOperations({ workspace: dependencies.workspace, codex: dependencies.codex }),
    ...threads,
    ...createConversationReader({ codex: dependencies.codex, threadDomain }),
    ...createConversationCommands({
      workspace: dependencies.workspace,
      codex: dependencies.codex,
      threadDomain,
      threads,
    }),
    ...eventServices,
  }
}
