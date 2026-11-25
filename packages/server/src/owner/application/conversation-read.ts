import type { CodexOwnerPort } from '../../codex/owner-port.js'
import type { ThreadDomain } from '../../threads/index.js'
import type { OwnerMethodContext } from '../session-runtime.js'
import { requireOwner } from '../owner-context.js'
import { OwnerMethodError } from '../errors.js'
import { safeId, mapThreadAccessFailure } from './validation.js'
import { applyChange, createConversationState } from '@codex-web/conversation'
import { isConversationChange } from '@codex-web/protocol/owner'
import { adaptCodexSnapshot } from '../../codex/conversation-adapter.js'
import { makeOwnerEventCursor } from '../event-services.js'

type Dependencies = {
  codex: { events: Pick<CodexOwnerPort['events'], 'captureThreadSnapshot'> }
  threadDomain: Pick<ThreadDomain, 'access'>
}

export function createConversationReader(dependencies: Dependencies) {
  const { threadDomain } = dependencies
  return {
    async threadsRead(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
      if (input.projectId !== undefined && input.projectId !== null && !safeId(input.projectId))
        throw new OwnerMethodError('INVALID_THREAD_QUERY')
      const threadId = input.threadId
      const events = dependencies.codex.events
      let historyError: unknown
      const readHistory = () =>
        events.captureThreadSnapshot(owner.ownerId, threadId).catch((error: unknown) => {
          historyError = error
          return null
        })
      let historyAtResponse: ReturnType<typeof readHistory> | undefined
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId,
        projectId: typeof input.projectId === 'string' ? input.projectId : undefined,
        includeTurns: true,
        mode: 'read',
        onReadResponse: () => {
          historyAtResponse = readHistory()
        },
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
      const cut = await (historyAtResponse ?? readHistory())
      if (!cut) throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: historyError })
      const { history, sequence } = cut
      const base = adaptCodexSnapshot(access.rawThread, sequence)
      if (!base || base.id !== threadId) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR', true)
      const snapshotMessages = new Set(
        Object.values(base.messages)
          .filter(
            (message) =>
              message.status !== 'inProgress' ||
              message.parts.some((part) => part.type !== 'text' || part.text.length > 0),
          )
          .map((message) => message.id),
      )
      let state = createConversationState(base)
      for (const { message } of history) {
        if (message.type !== 'conversation.change') continue
        const change = message.payload.change
        if (!isConversationChange(change)) continue
        switch (change.type) {
          case 'message.upserted':
            if (snapshotMessages.has(change.message.id)) continue
            if (base.turns[change.message.turnId]?.status !== 'inProgress') continue
            break
          case 'message.partAdded':
          case 'message.textDelta':
          case 'message.statusChanged':
            if (!Object.hasOwn(state.messages, change.messageId)) continue
            if (snapshotMessages.has(change.messageId)) continue
            break
          case 'activity.upserted':
            if (Object.hasOwn(base.activities, change.activity.id)) continue
            if (base.turns[change.activity.turnId]?.status !== 'inProgress') continue
            break
          case 'activity.outputDelta':
          case 'activity.statusChanged':
            if (!Object.hasOwn(state.activities, change.activityId)) continue
            if (Object.hasOwn(base.activities, change.activityId)) continue
            break
          case 'turn.planUpdated':
            if (!Object.hasOwn(base.turns, change.turnId)) continue
            if (base.turns[change.turnId]?.plan !== undefined) continue
            break
          case 'turn.diffUpdated':
            if (!Object.hasOwn(base.turns, change.turnId)) continue
            if (base.turns[change.turnId]?.diff !== undefined) continue
            break
          case 'interaction.opened':
          case 'interaction.resolved':
          case 'interaction.cancelled':
            break
          default:
            continue
        }
        state = applyChange(state, change)
      }
      const { seenSourceEvents: _, ...domainSnapshot } = state
      return { snapshot: domainSnapshot, watermark: makeOwnerEventCursor(owner.ownerId, sequence) }
    },
  }
}
