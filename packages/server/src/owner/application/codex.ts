import type { CodexOwnerPort } from '../../codex/owner-port.js'
import type { WorkspaceService } from '../../workspace.js'
import type { OwnerMethodContext } from '../session-runtime.js'
import { requireOwner } from '../owner-context.js'
import { OwnerMethodError } from '../errors.js'
import { isRecord, safeId } from './validation.js'
import { skillsForCwd, summarizeSkill } from '../../skills.js'

type Dependencies = {
  workspace: Pick<
    WorkspaceService,
    | 'getCurrentCredentialId'
    | 'setCurrentCredentialId'
    | 'getCredential'
    | 'getProject'
    | 'getUserRoot'
  >
  codex: Pick<CodexOwnerPort, 'getStatus' | 'modelCatalog' | 'getReady' | 'start' | 'restart'>
}

export function createCodexOperations(dependencies: Dependencies) {
  return {
    async codexStatus(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      const status = dependencies.codex.getStatus(owner.ownerId)
      return {
        ...status,
        activeTurns: status.activeTurns ?? 0,
        currentCredentialId: await dependencies.workspace.getCurrentCredentialId(owner.ownerId),
      }
    },

    async capabilitiesList(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      try {
        return { models: await dependencies.codex.modelCatalog(owner.ownerId) }
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async configurationContextWindowRead(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      const client = await readyClient(owner.ownerId)
      try {
        const result = await client.request('config/read', { includeLayers: false })
        const configured =
          isRecord(result) && isRecord(result.config)
            ? result.config.model_context_window
            : undefined
        return {
          modelContextWindow:
            typeof configured === 'number' && Number.isSafeInteger(configured) && configured > 0
              ? configured
              : 256_000,
          source:
            typeof configured === 'number' && Number.isSafeInteger(configured) && configured > 0
              ? 'configured'
              : 'default',
        }
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async configurationContextWindowWrite(
      context: OwnerMethodContext,
      input: { modelContextWindow?: unknown },
    ) {
      const owner = requireOwner(context)
      const value = input.modelContextWindow
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
        throw new OwnerMethodError('INVALID_PARAMS')
      const client = await readyClient(owner.ownerId)
      try {
        await client.request('config/value/write', {
          keyPath: 'model_context_window',
          value,
          mergeStrategy: 'replace',
        })
        return { modelContextWindow: value, source: 'configured' }
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async codexLifecycle(
      context: OwnerMethodContext,
      input: {
        operation?: unknown
        credentialId?: unknown
      },
    ) {
      const owner = requireOwner(context)
      const operation = input.operation === 'restart' ? 'restart' : 'start'
      if (
        input.operation !== undefined &&
        input.operation !== 'start' &&
        input.operation !== 'restart'
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      if (input.credentialId !== undefined && !safeId(input.credentialId))
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      const credentialId =
        input.credentialId ?? (await dependencies.workspace.getCurrentCredentialId(owner.ownerId))
      if (!credentialId) throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      if (!(await dependencies.workspace.getCredential(owner.ownerId, credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      const method = operation === 'restart' ? dependencies.codex.restart : dependencies.codex.start
      try {
        await method.call(dependencies.codex, owner.ownerId, '', credentialId)
        await dependencies.workspace.setCurrentCredentialId(owner.ownerId, credentialId)
        return this.codexStatus(context)
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async skillsList(context: OwnerMethodContext, input: { projectId?: unknown }) {
      const owner = requireOwner(context)
      if (input.projectId != null && !safeId(input.projectId))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const project = input.projectId
        ? await dependencies.workspace.getProject(owner.ownerId, input.projectId)
        : null
      if (input.projectId && !project) throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const cwd = project?.path ?? dependencies.workspace.getUserRoot(owner.ownerId)
      const client = await readyClient(owner.ownerId)
      try {
        const result = await client.request('skills/list', { cwds: [cwd] })
        return skillsForCwd(result, cwd).map(summarizeSkill)
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },
  }
  async function readyClient(ownerId: string) {
    try {
      return await dependencies.codex.getReady(ownerId)
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }
}
