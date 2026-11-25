import type { CodexOwnerPort } from '../../codex/owner-port.js'
import type { WorkspaceService } from '../../workspace.js'
import type { ThreadDomain } from '../../threads/index.js'
import type { OwnerMethodContext } from '../session-runtime.js'
import { requireOwner } from '../owner-context.js'
import { OwnerMethodError } from '../errors.js'
import { isRecord, safeId, mapThreadAccessFailure } from './validation.js'
import { parseSkills, resolveSelectedSkills } from '../skill-selection.js'
import { turnInput } from '../../skills.js'

type Dependencies = {
  workspace: Pick<WorkspaceService, 'getProject' | 'getUserRoot'>
  codex: Pick<CodexOwnerPort, 'getReady' | 'modelCatalog' | 'markThreadLoaded' | 'enqueueTurn'>
  threadDomain: Pick<ThreadDomain, 'access' | 'list' | 'pathIsWithin'>
}

export function createThreadOperations(dependencies: Dependencies) {
  const { threadDomain } = dependencies
  const MAX_INITIAL_MESSAGE_LENGTH = 256_000
  return {
    async threadsList(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const projectId = input.projectId
      if (projectId !== undefined && projectId !== null && !safeId(projectId))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const limitInput = input.limit === undefined ? 30 : Number(input.limit)
      if (!Number.isSafeInteger(limitInput) || limitInput < 1)
        throw new OwnerMethodError('INVALID_THREAD_QUERY')
      const result = await threadDomain.list({
        userId: owner.ownerId,
        ...(typeof projectId === 'string' ? { projectId } : {}),
        ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}),
        limit: Math.min(limitInput, 100),
        archived: input.archived === true,
      })
      if (result.kind !== 'ok') throw mapThreadAccessFailure(result)
      return result
    },

    async threadsCreate(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const projectId = input.projectId
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      const model = typeof input.model === 'string' ? input.model.trim() : ''
      const reasoningEffort = input.reasoningEffort
      const collaborationMode = input.collaborationMode
      const selection = parseSkills(input.skills)
      if (
        (projectId !== undefined && projectId !== null && !safeId(projectId)) ||
        !text ||
        text.length > MAX_INITIAL_MESSAGE_LENGTH ||
        !safeId(model) ||
        typeof reasoningEffort !== 'string' ||
        !safeId(reasoningEffort) ||
        (collaborationMode !== undefined &&
          collaborationMode !== 'default' &&
          collaborationMode !== 'plan') ||
        selection === null
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const project =
        typeof projectId === 'string'
          ? await dependencies.workspace.getProject(owner.ownerId, projectId)
          : null
      if (projectId && !project) throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const client = await readyClient(owner.ownerId)
      const catalog = await dependencies.codex.modelCatalog(owner.ownerId)
      const selectedModel = catalog.find((entry) => entry.id === model)
      if (
        !selectedModel ||
        !selectedModel.reasoningEfforts.some((entry) => entry.id === reasoningEffort)
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const cwd = project?.path ?? dependencies.workspace.getUserRoot(owner.ownerId)
      const selectedSkills = await resolveSelectedSkills(client, cwd, selection)
      if (!selectedSkills) throw new OwnerMethodError('INVALID_TURN_REQUEST')
      try {
        const threadResult = await client.request('thread/start', {
          cwd,
          model,
          approvalPolicy: 'never',
          sandbox: 'danger-full-access',
        })
        const rawThread = isRecord(threadResult) ? threadResult.thread : undefined
        const threadId = isRecord(rawThread) ? rawThread.id : undefined
        if (!safeId(threadId)) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
        dependencies.codex.markThreadLoaded(owner.ownerId, threadId)
        const run = () =>
          client.request('turn/start', {
            threadId,
            input: turnInput(text, selectedSkills),
            effort: reasoningEffort,
            collaborationMode: {
              mode: collaborationMode ?? 'plan',
              settings: { model, reasoning_effort: reasoningEffort },
            },
          })
        const turnResult = await dependencies.codex.enqueueTurn(
          owner.ownerId,
          run,
          undefined,
          undefined,
          threadId,
        )
        const turn = isRecord(turnResult) ? turnResult.turn : undefined
        const turnId = isRecord(turn) ? turn.id : undefined
        if (!safeId(turnId)) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
        return { threadId, turnId, projectId: projectId ?? null }
      } catch (error) {
        if (error instanceof OwnerMethodError) throw error
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async threadsArchive(context: OwnerMethodContext, input: Record<string, unknown>) {
      return threadMutation(context, input, 'thread/archive')
    },

    async threadsUnarchive(context: OwnerMethodContext, input: Record<string, unknown>) {
      return threadMutation(context, input, 'thread/unarchive', true)
    },

    async threadsDelete(context: OwnerMethodContext, input: Record<string, unknown>) {
      return threadMutation(context, input, 'thread/delete', true)
    },

    async threadsDeleteAll(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (input.archived !== true) throw new OwnerMethodError('INVALID_THREAD_QUERY')
      const client = await readyClient(owner.ownerId)
      const userRoot = dependencies.workspace.getUserRoot(owner.ownerId)
      let cursor: string | undefined
      try {
        do {
          // oxlint-disable-next-line no-await-in-loop
          const result = (await client.request('thread/list', {
            archived: true,
            ...(cursor ? { cursor } : {}),
            limit: 100,
            sortDirection: 'desc',
            sortKey: 'updated_at',
          })) as { data?: unknown; nextCursor?: unknown }
          for (const thread of Array.isArray(result.data) ? result.data : []) {
            const id = isRecord(thread) ? thread.id : undefined
            const cwd = isRecord(thread) ? thread.cwd : undefined
            if (safeId(id) && threadDomain.pathIsWithin(cwd, userRoot)) {
              // oxlint-disable-next-line no-await-in-loop
              await client.request('thread/delete', { threadId: id })
            }
          }
          cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined
        } while (cursor)
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
      return { deleted: true }
    },
  }
  async function threadMutation(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
    method: string,
    archived = false,
  ) {
    const owner = requireOwner(context)
    if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
    const projectId = input.projectId
    if (projectId !== undefined && !safeId(projectId))
      throw new OwnerMethodError('PROJECT_NOT_FOUND')
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId: input.threadId,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      archived,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    try {
      await access.client.request(method, { threadId: input.threadId })
      return { accepted: true }
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  async function readyClient(ownerId: string) {
    try {
      return await dependencies.codex.getReady(ownerId)
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }
}
