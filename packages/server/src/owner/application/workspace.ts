import type { CodexOwnerPort } from '../../codex/owner-port.js'
import type { WorkspaceService } from '../../workspace.js'
import type { OwnerMethodContext } from '../session-runtime.js'
import { requireOwner } from '../owner-context.js'
import { OwnerMethodError } from '../errors.js'

type Dependencies = {
  workspace: Pick<
    WorkspaceService,
    | 'listCredentials'
    | 'getCurrentCredentialId'
    | 'setCurrentCredentialId'
    | 'saveCredential'
    | 'getCredential'
    | 'testCredential'
    | 'deleteCredential'
    | 'listProjects'
    | 'createProject'
    | 'renameProject'
    | 'deleteProject'
  >
  codex: Pick<CodexOwnerPort, 'markCredentialPending' | 'stop'>
}

export function createWorkspaceOperations(dependencies: Dependencies) {
  return {
    async credentialsList(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      return {
        credentials: await dependencies.workspace.listCredentials(owner.ownerId),
        currentCredentialId: await dependencies.workspace.getCurrentCredentialId(owner.ownerId),
      }
    },

    async credentialSelect(context: OwnerMethodContext, input: { credentialId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.credentialId !== 'string' || !input.credentialId)
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      if (!(await dependencies.workspace.setCurrentCredentialId(owner.ownerId, input.credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      return { currentCredentialId: input.credentialId }
    },

    async credentialCreate(
      context: OwnerMethodContext,
      input: { provider?: unknown; baseUrl?: unknown; apiKey?: unknown },
    ) {
      const owner = requireOwner(context)
      if (
        typeof input.provider !== 'string' ||
        typeof input.baseUrl !== 'string' ||
        typeof input.apiKey !== 'string'
      )
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      try {
        const saved = await dependencies.workspace.saveCredential(owner.ownerId, {
          provider: input.provider,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
        })
        dependencies.codex.markCredentialPending(owner.ownerId, saved.id)
        return saved
      } catch (error) {
        throw new OwnerMethodError('INVALID_CREDENTIAL', false, { cause: error })
      }
    },

    async credentialTest(context: OwnerMethodContext, input: { credentialId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.credentialId !== 'string' || !input.credentialId)
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      if (!(await dependencies.workspace.getCredential(owner.ownerId, input.credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      try {
        await dependencies.workspace.testCredential(owner.ownerId, input.credentialId)
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
      return { ok: true }
    },

    async credentialDelete(context: OwnerMethodContext, input: { credentialId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.credentialId !== 'string' || !input.credentialId)
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      if (!(await dependencies.workspace.deleteCredential(owner.ownerId, input.credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      await dependencies.codex.stop(owner.ownerId)
      return { deleted: true }
    },

    async projectsList(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      return { projects: await dependencies.workspace.listProjects(owner.ownerId) }
    },

    async projectCreate(context: OwnerMethodContext, input: { name?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.name !== 'string') throw new OwnerMethodError('INVALID_PARAMS')
      try {
        return await dependencies.workspace.createProject(owner.ownerId, input.name)
      } catch (error) {
        if (error instanceof Error && error.name === 'ProjectConflictError')
          throw new OwnerMethodError('PROJECT_EXISTS')
        throw new OwnerMethodError('INVALID_PARAMS', false, { cause: error })
      }
    },

    async projectRename(
      context: OwnerMethodContext,
      input: { projectId?: unknown; name?: unknown },
    ) {
      const owner = requireOwner(context)
      if (typeof input.projectId !== 'string' || typeof input.name !== 'string')
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const renamed = await dependencies.workspace.renameProject(
          owner.ownerId,
          input.projectId,
          input.name,
        )
        if (!renamed) throw new OwnerMethodError('PROJECT_NOT_FOUND')
        return renamed
      } catch (error) {
        if (error instanceof OwnerMethodError) throw error
        if (error instanceof Error && error.name === 'ProjectConflictError')
          throw new OwnerMethodError('PROJECT_EXISTS')
        throw new OwnerMethodError('INVALID_PARAMS', false, { cause: error })
      }
    },

    async projectDelete(context: OwnerMethodContext, input: { projectId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.projectId !== 'string' || !input.projectId)
        throw new OwnerMethodError('INVALID_PARAMS')
      if (!(await dependencies.workspace.deleteProject(owner.ownerId, input.projectId)))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      return { deleted: true }
    },
  }
}
