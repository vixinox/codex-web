import type { CodexOwnerPort } from '../../codex/owner-port.js'
import type { WorkspaceService } from '../../workspace.js'
import type { ThreadDomain } from '../../threads/index.js'
import type { OwnerMethodContext } from '../session-runtime.js'
import { requireOwner } from '../owner-context.js'
import { OwnerMethodError } from '../errors.js'
import { isRecord, safeId, mapThreadAccessFailure } from './validation.js'
import type { Interaction } from '@codex-web/conversation'
import { isConversationChange } from '@codex-web/protocol/owner'
import { CodexRpcRequestError } from '../../codex/rpc-client.js'
import { parseSkills, resolveSelectedSkills } from '../skill-selection.js'
import { turnInput } from '../../skills.js'
import type { createThreadOperations } from './threads.js'

type Dependencies = {
  workspace: Pick<WorkspaceService, 'getUserRoot'>
  codex: Pick<
    CodexOwnerPort,
    'modelCatalog' | 'ensureThread' | 'enqueueTurn' | 'cancelQueuedTurn' | 'respondToServerRequest'
  > & { events: Pick<CodexOwnerPort['events'], 'threadHistory'> }
  threadDomain: Pick<ThreadDomain, 'access'>
  threads: Pick<ReturnType<typeof createThreadOperations>, 'threadsArchive'>
}

export function createConversationCommands(dependencies: Dependencies) {
  const { threadDomain } = dependencies
  const MAX_INITIAL_MESSAGE_LENGTH = 256_000
  return {
    async conversationCommand(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const threadId = input.conversationId
      if (!safeId(threadId)) throw new OwnerMethodError('INVALID_PARAMS')

      switch (input.type) {
        case 'turn.start': {
          const part: unknown =
            Array.isArray(input.input) && input.input.length === 1 ? input.input[0] : undefined
          if (
            !isRecord(part) ||
            part.type !== 'text' ||
            !safeId(part.id) ||
            typeof part.text !== 'string'
          )
            throw new OwnerMethodError('INVALID_TURN_REQUEST')
          return startConversationTurn(context, {
            threadId,
            text: part.text,
            projectId: input.projectId,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            collaborationMode: input.collaborationMode,
            skills: input.skills,
          })
        }
        case 'turn.steer':
          return steerConversationTurn(context, { ...input, threadId })
        case 'turn.cancel':
          return cancelConversationTurn(context, { threadId, turnId: input.turnId })
        case 'conversation.compact':
          return compactConversation(context, { threadId })
        case 'conversation.archive':
          return dependencies.threads.threadsArchive(context, {
            threadId,
            projectId: input.projectId,
          })
        case 'interaction.respond': {
          const { interactionId, outcome } = input
          if (!safeId(interactionId) || !isRecord(outcome))
            throw new OwnerMethodError('INVALID_PARAMS')
          const access = await threadDomain.access({
            userId: owner.ownerId,
            threadId,
            mode: 'mutation',
          })
          if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
          const history = await dependencies.codex.events.threadHistory(owner.ownerId, threadId)
          let interaction: Interaction | undefined
          for (const { message } of history) {
            if (message.type !== 'conversation.change' || message.threadId !== threadId) continue
            const change = message.payload.change
            if (!isConversationChange(change)) continue
            if (change.type === 'interaction.opened' && change.interaction.id === interactionId)
              interaction ??= change.interaction
            else if (
              (change.type === 'interaction.resolved' || change.type === 'interaction.cancelled') &&
              change.interactionId === interactionId
            ) {
              interaction = undefined
              break
            }
          }
          if (interaction?.status !== 'pending') throw new OwnerMethodError('RESOURCE_NOT_FOUND')
          const requestId = interaction.id
          if (
            interaction.kind === 'userInput' &&
            outcome.kind === 'answers' &&
            isRecord(outcome.answers)
          ) {
            const entries = Object.entries(outcome.answers)
            if (
              !entries.every(
                ([, answers]) =>
                  Array.isArray(answers) && answers.every((answer) => typeof answer === 'string'),
              )
            )
              throw new OwnerMethodError('INVALID_PARAMS')
            return replyToInteraction(owner.ownerId, threadId, requestId, {
              answers: Object.fromEntries(entries.map(([id, answers]) => [id, { answers }])),
            })
          }
          const decision =
            outcome.kind === 'approved'
              ? 'accept'
              : outcome.kind === 'rejected'
                ? 'decline'
                : outcome.kind === 'dismissed'
                  ? 'cancel'
                  : outcome.kind === 'submitted'
                    ? outcome.value
                    : undefined
          if (
            interaction.kind !== 'approval' ||
            (decision !== 'accept' &&
              decision !== 'acceptForSession' &&
              decision !== 'decline' &&
              decision !== 'cancel') ||
            (interaction.details?.kind === 'approval' &&
              interaction.details.choices.length > 0 &&
              !interaction.details.choices.some((choice) => choice.id === decision))
          )
            throw new OwnerMethodError('INVALID_PARAMS')
          return replyToInteraction(owner.ownerId, threadId, requestId, decision)
        }
        default:
          throw new OwnerMethodError('INVALID_PARAMS')
      }
    },
  }
  async function startConversationTurn(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
  ) {
    const owner = requireOwner(context)
    const threadId = input.threadId
    const projectId = input.projectId
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    const model = typeof input.model === 'string' ? input.model.trim() : ''
    const reasoningEffort = input.reasoningEffort
    const collaborationMode = input.collaborationMode
    const selection = parseSkills(input.skills)
    if (
      !safeId(threadId) ||
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
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    const catalog = await dependencies.codex.modelCatalog(owner.ownerId)
    const selectedModel = catalog.find((entry) => entry.id === model)
    if (
      !selectedModel ||
      !selectedModel.reasoningEfforts.some((entry) => entry.id === reasoningEffort)
    )
      throw new OwnerMethodError('INVALID_TURN_REQUEST')
    const userRoot = dependencies.workspace.getUserRoot(owner.ownerId)
    await dependencies.codex.ensureThread(owner.ownerId, threadId)
    const selectedSkills = await resolveSelectedSkills(
      access.client,
      access.scope === 'project' ? access.cwd : userRoot,
      selection,
    )
    if (!selectedSkills) throw new OwnerMethodError('INVALID_TURN_REQUEST')
    const run = () =>
      access.client.request('turn/start', {
        threadId,
        input: turnInput(text, selectedSkills),
        model,
        effort: reasoningEffort,
        collaborationMode: {
          mode: collaborationMode ?? 'plan',
          settings: { model, reasoning_effort: reasoningEffort },
        },
      })
    try {
      const result = await dependencies.codex.enqueueTurn(
        owner.ownerId,
        run,
        undefined,
        undefined,
        threadId,
      )
      const turn = isRecord(result) ? result.turn : undefined
      const turnId = isRecord(turn) ? turn.id : undefined
      if (!safeId(turnId)) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
      return { turnId }
    } catch (error) {
      if (error instanceof OwnerMethodError) throw error
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  async function steerConversationTurn(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
  ) {
    const owner = requireOwner(context)
    const part = Array.isArray(input.input) && input.input.length === 1 ? input.input[0] : undefined
    const selection = parseSkills(input.skills)
    if (
      !safeId(input.threadId) ||
      !safeId(input.expectedTurnId) ||
      !isRecord(part) ||
      part.type !== 'text' ||
      !safeId(part.id) ||
      typeof part.text !== 'string' ||
      !part.text.trim() ||
      part.text.length > MAX_INITIAL_MESSAGE_LENGTH ||
      selection === null
    )
      throw new OwnerMethodError('INVALID_TURN_REQUEST')
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId: input.threadId,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    const skills = await resolveSelectedSkills(
      access.client,
      access.scope === 'project' ? access.cwd : dependencies.workspace.getUserRoot(owner.ownerId),
      selection,
    )
    if (!skills) throw new OwnerMethodError('INVALID_TURN_REQUEST')
    try {
      const result = await access.client.request('turn/steer', {
        threadId: input.threadId,
        expectedTurnId: input.expectedTurnId,
        input: turnInput(part.text, skills),
      })
      if (!isRecord(result) || result.turnId !== input.expectedTurnId)
        throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
      return { turnId: result.turnId }
    } catch (error) {
      if (error instanceof OwnerMethodError) throw error
      throw new OwnerMethodError(
        error instanceof CodexRpcRequestError ? 'INVALID_TURN_REQUEST' : 'CODEX_UNAVAILABLE',
        false,
        { cause: error },
      )
    }
  }

  async function cancelConversationTurn(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
  ) {
    const owner = requireOwner(context)
    if (!safeId(input.threadId) || !safeId(input.turnId))
      throw new OwnerMethodError('INVALID_TURN_REQUEST')
    const threadId = input.threadId
    const turnId = input.turnId
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    if (dependencies.codex.cancelQueuedTurn(owner.ownerId, turnId)) return { cancelled: true }
    try {
      const result = await access.client.request('turn/interrupt', { threadId, turnId })
      return { result }
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  async function compactConversation(context: OwnerMethodContext, input: Record<string, unknown>) {
    const owner = requireOwner(context)
    if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId: input.threadId,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    try {
      await access.client.request('thread/compact/start', { threadId: input.threadId })
      return { accepted: true }
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  function replyToInteraction(
    ownerId: string,
    threadId: string,
    requestId: string | number,
    result: unknown,
  ) {
    try {
      dependencies.codex.respondToServerRequest(ownerId, threadId, requestId, result)
      return { accepted: true }
    } catch (error) {
      throw new OwnerMethodError('RESOURCE_NOT_FOUND', false, { cause: error })
    }
  }
}
