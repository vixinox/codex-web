import { randomUUID } from 'node:crypto'
import type {
  EventIdentity,
  Interaction,
  InteractionOutcome,
  SourceEventId,
  SourceId,
  TurnId,
} from '@codex-web/conversation'
import {
  adaptCodexNotification,
  isCodexInteractionRequest,
  isFileChangeDecision,
} from '../conversation-adapter.js'
import { workspaceEvent } from '../domain-events.js'
import type { CodexRpcClient } from '../rpc-client.js'
import type { RequestId } from '../request-id.js'
import type { EventHub } from '../event-hub.js'
import { log } from '../../logger.js'

type PendingServerRequest = {
  client: CodexRpcClient
  threadId: string
  rpcId: RequestId
  interaction: Interaction
  fileChange: boolean
}
type ActiveTurn = { threadId: string; turnId: string }

function codexEventIdentity(): EventIdentity {
  return {
    sourceId: 'codex-app-server' as SourceId,
    sourceEventId: randomUUID() as SourceEventId,
    receivedAt: new Date().toISOString(),
  }
}

function interactionResponseOutcome(interaction: Interaction, result: unknown): InteractionOutcome {
  if (interaction.kind !== 'approval') {
    const answers =
      result && typeof result === 'object' && 'answers' in result ? result.answers : undefined
    return {
      kind: 'answers',
      answers: Object.fromEntries(
        answers && typeof answers === 'object'
          ? Object.entries(answers).flatMap(([key, entry]) =>
              entry &&
              typeof entry === 'object' &&
              'answers' in entry &&
              Array.isArray(entry.answers) &&
              entry.answers.every((answer: unknown) => typeof answer === 'string')
                ? [[key, entry.answers]]
                : [],
            )
          : [],
      ),
    }
  }
  const decision =
    result && typeof result === 'object' && 'decision' in result ? result.decision : result
  if (decision === 'accept' || decision === 'acceptForSession') return { kind: 'approved' }
  if (decision === 'decline') return { kind: 'rejected' }
  if (decision === 'cancel') return { kind: 'dismissed' }
  if (decision && typeof decision === 'object' && 'acceptWithExecpolicyAmendment' in decision)
    return { kind: 'approved' }
  return { kind: 'submitted', value: null }
}

/** Owns notification-derived activity and pending Interaction correlation. */
export class ProcessEvents {
  private readonly serverRequests = new Map<string, Map<RequestId, PendingServerRequest>>()
  private readonly activeTurnsByUser = new Map<string, Map<string, ActiveTurn>>()
  private readonly events: EventHub
  constructor(events: EventHub) {
    this.events = events
  }
  activeCount(userId: string) {
    return this.activeTurnsByUser.get(userId)?.size ?? 0
  }
  clearActivity(userId: string) {
    this.activeTurnsByUser.delete(userId)
  }
  cancelActiveTurns(userId: string) {
    for (const turn of this.activeTurnsByUser.get(userId)?.values() ?? [])
      void this.publishConversationChange(userId, turn.threadId, {
        type: 'turn.statusChanged',
        identity: codexEventIdentity(),
        turnId: turn.turnId as TurnId,
        status: 'cancelled',
      })
  }
  attach(userId: string, client: CodexRpcClient, endpointHost: string) {
    const publishConversation = (
      threadId: string,
      method: string,
      params: Record<string, unknown>,
    ) => {
      const identity = codexEventIdentity()
      for (const change of adaptCodexNotification(method, { ...params, threadId }, identity))
        void this.publishConversationChange(userId, threadId, change)
    }
    client.onEvent((message) => {
      const params = message.params as Record<string, unknown> | undefined
      if (message.method === 'serverRequest/resolved') {
        const requests = this.serverRequests.get(userId)
        for (const [correlation, pending] of requests ?? []) {
          if (
            pending.client !== client ||
            pending.threadId !== params?.threadId ||
            pending.rpcId !== params?.requestId
          )
            continue
          requests?.delete(correlation)
          if (requests?.size === 0) this.serverRequests.delete(userId)
          this.finishInteraction(userId, pending, { kind: 'dismissed' })
          break
        }
        return
      }
      if (message.method === 'turn/failed') {
        const turn = params?.turn as Record<string, unknown> | undefined
        const error = turn?.error as Record<string, unknown> | undefined
        const messageText =
          typeof error?.message === 'string' ? error.message : 'Unknown turn error'
        log.error('codex.turn.failed', { messageLength: messageText.length })
      }
      if (message.method === 'error') {
        const error = params?.error as Record<string, unknown> | undefined
        const messageText =
          typeof error?.message === 'string' ? error.message : 'Unknown runtime error'
        const details = typeof error?.additionalDetails === 'string' ? error.additionalDetails : ''
        log.error('codex.runtime.error-event', {
          endpointHost: endpointHost,
          messageLength: messageText.length,
          detailsLength: details.length,
        })
      }
      const threadId = typeof params?.threadId === 'string' ? params.threadId : undefined
      const turn = params?.turn as Record<string, unknown> | undefined
      const turnId =
        typeof turn?.id === 'string'
          ? turn.id
          : typeof params?.turnId === 'string'
            ? params.turnId
            : undefined
      if (threadId && turnId && typeof message.method === 'string') {
        const map = this.activeTurnsByUser.get(userId) ?? new Map<string, ActiveTurn>()
        if (message.method === 'turn/started') map.set(turnId, { threadId, turnId })
        if (message.method === 'turn/completed' || message.method === 'turn/failed') {
          map.delete(turnId)
          this.expireServerRequests(userId, client, { threadId, turnId })
        }
        this.activeTurnsByUser.set(userId, map)
      }
      const workspace = workspaceEvent(message)
      if (workspace)
        void this.events
          .publishDomain(userId, workspace)
          .catch(() => log.warn('codex.workspace.delivery-failed'))
      const conversationId =
        threadId ??
        (params?.thread &&
        typeof params.thread === 'object' &&
        'id' in params.thread &&
        typeof params.thread.id === 'string'
          ? params.thread.id
          : undefined)
      if (conversationId && typeof message.method === 'string')
        publishConversation(conversationId, message.method, params ?? {})
    })
    client.onRequest((message) => {
      const requestId = message.id
      if (typeof requestId !== 'number' && typeof requestId !== 'string') return
      const method = message.method
      if (typeof method !== 'string' || !isCodexInteractionRequest(method)) {
        client.respondError(requestId, { code: -32601, message: 'Unsupported interaction request' })
        return
      }
      const params = message.params as Record<string, unknown> | undefined
      const threadId = typeof params?.threadId === 'string' ? params.threadId : undefined
      if (!threadId) {
        client.respondError(requestId, { code: -32602, message: 'threadId is required' })
        return
      }
      const requests = this.serverRequests.get(userId) ?? new Map<RequestId, PendingServerRequest>()
      if (
        [...requests.values()].some(
          (pending) => pending.client === client && pending.rpcId === requestId,
        )
      )
        return
      const correlation = `interaction-${randomUUID()}`
      const [change] = adaptCodexNotification(
        method,
        {
          ...(message.params as Record<string, unknown> | undefined),
          threadId,
          requestId: correlation,
        },
        codexEventIdentity(),
      )
      if (change?.type !== 'interaction.opened') {
        client.respondError(requestId, { code: -32602, message: 'Invalid interaction request' })
        return
      }
      requests.set(correlation, {
        client,
        threadId,
        rpcId: requestId,
        interaction: change.interaction,
        fileChange: method === 'item/fileChange/requestApproval',
      })
      this.serverRequests.set(userId, requests)
      void this.publishConversationChange(userId, threadId, change)
    })
  }
  respondToServerRequest(userId: string, threadId: string, requestId: RequestId, result: unknown) {
    const requests = this.serverRequests.get(userId)
    const correlation = requests?.has(requestId)
      ? requestId
      : [...(requests ?? [])].find(([, entry]) => entry.interaction.id === requestId)?.[0]
    const pending = correlation === undefined ? undefined : requests?.get(correlation)
    if (!requests || !pending || pending.threadId !== threadId)
      throw new Error('Approval request not found')
    if (pending.fileChange && !isFileChangeDecision(result))
      throw new Error('Invalid file change approval decision')
    if (correlation !== undefined) requests.delete(correlation)
    if (requests.size === 0) this.serverRequests.delete(userId)
    try {
      pending.client.respond(pending.rpcId, pending.fileChange ? { decision: result } : result)
    } catch {
      this.finishInteraction(userId, pending, 'expired')
      throw new Error('Codex RPC response failed')
    }
    this.finishInteraction(userId, pending, interactionResponseOutcome(pending.interaction, result))
    return pending.rpcId
  }

  private publishConversationChange(
    userId: string,
    conversationId: string,
    change: import('@codex-web/conversation').ConversationChange,
  ) {
    return this.events
      .publishConversationChange(userId, conversationId, change)
      .catch(() => log.warn('codex.conversation.delivery-failed'))
  }

  private finishInteraction(
    userId: string,
    pending: PendingServerRequest,
    result: InteractionOutcome | 'cancelled' | 'expired',
  ) {
    const identity = codexEventIdentity()
    const terminal = {
      identity,
      interactionId: pending.interaction.id,
      resolvedAt: identity.receivedAt,
    }
    void this.publishConversationChange(
      userId,
      pending.threadId,
      typeof result === 'string'
        ? { ...terminal, type: 'interaction.cancelled', status: result }
        : { ...terminal, type: 'interaction.resolved', outcome: result },
    )
  }

  expireServerRequests(userId: string, client: CodexRpcClient, turn?: ActiveTurn) {
    const requests = this.serverRequests.get(userId)
    if (!requests) return
    for (const [correlation, pending] of requests) {
      if (pending.client !== client) continue
      if (
        turn &&
        (turn.threadId !== pending.threadId || turn.turnId !== pending.interaction.turnId)
      )
        continue
      requests.delete(correlation)
      this.finishInteraction(userId, pending, turn ? 'cancelled' : 'expired')
    }
    if (requests.size === 0) this.serverRequests.delete(userId)
  }
}
