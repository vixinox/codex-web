import { createHash, randomUUID } from 'node:crypto'
import { parseOwnerEventCursor, type OwnerEventCursor } from '@codex-web/protocol/owner'
import type { CodexOwnerPort } from '../codex/owner-port.js'
import { OwnerMethodError } from './errors.js'
import { requireOwner } from './owner-context.js'
import type { OwnerMethodContext } from './session-runtime.js'

const SUBSCRIPTION_TTL_MS = 10 * 60 * 1000
const MAX_SUBSCRIPTIONS = 2048
const PROCESS_EVENT_EPOCH = randomUUID()

type OwnerSubscription = {
  ownerId: string
  sessionId: string
  scope: 'thread' | 'workspace'
  threadId?: string
  expiresAt: number
}

export type OwnerEventServiceOptions = {
  now?: () => number
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}

export function makeOwnerEventCursor(ownerId: string, sequence: number): OwnerEventCursor {
  const epoch = createHash('sha256').update(`${PROCESS_EVENT_EPOCH}:${ownerId}`).digest('base64url')
  return { epoch, sequence }
}

function parseEventCursor(value: unknown): OwnerEventCursor | null | undefined {
  if (value === undefined) return undefined
  return parseOwnerEventCursor(value)
}

function safeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

export function createOwnerEventServices(
  input: {
    events: Pick<
      CodexOwnerPort['events'],
      'latestEventId' | 'isCursorExpired' | 'isCursorAhead' | 'subscribeFrom'
    >
    assertThreadReadable: (ownerId: string, threadId: string) => Promise<void>
  },
  options: OwnerEventServiceOptions = {},
) {
  const now = options.now ?? Date.now
  const scheduleTimeout = options.setTimeout ?? setTimeout
  const cancelTimeout = options.clearTimeout ?? clearTimeout
  const subscriptions = new Map<string, OwnerSubscription>()
  let expirationTimer: ReturnType<typeof setTimeout> | undefined

  function pruneExpired(at = now()) {
    for (const [id, subscription] of subscriptions) {
      if (subscription.expiresAt <= at) subscriptions.delete(id)
    }
  }

  function scheduleExpirationCleanup() {
    if (expirationTimer !== undefined) cancelTimeout(expirationTimer)
    expirationTimer = undefined
    if (subscriptions.size === 0) return

    const nextExpiry = Math.min(...[...subscriptions.values()].map(({ expiresAt }) => expiresAt))
    expirationTimer = scheduleTimeout(
      () => {
        expirationTimer = undefined
        pruneExpired()
        scheduleExpirationCleanup()
      },
      Math.max(0, nextExpiry - now()),
    )
    expirationTimer.unref?.()
  }

  async function eventsSubscribe(context: OwnerMethodContext, params: Record<string, unknown>) {
    const owner = requireOwner(context)
    pruneExpired()
    const requestedSubscriptionId = params.subscriptionId
    if (requestedSubscriptionId !== undefined && !safeId(requestedSubscriptionId))
      throw new OwnerMethodError('SUBSCRIPTION_EXPIRED')
    const existing =
      typeof requestedSubscriptionId === 'string'
        ? subscriptions.get(requestedSubscriptionId)
        : undefined
    if (
      requestedSubscriptionId !== undefined &&
      (!existing ||
        existing.ownerId !== owner.ownerId ||
        existing.sessionId !== owner.sessionId ||
        existing.expiresAt <= now())
    ) {
      throw new OwnerMethodError('SUBSCRIPTION_EXPIRED')
    }
    const scope = existing?.scope ?? (params.scope === 'workspace' ? 'workspace' : 'thread')
    const threadId = params.threadId
    if (scope === 'thread' && !safeId(threadId)) throw new OwnerMethodError('INVALID_EVENT_CURSOR')
    if (scope === 'thread') await input.assertThreadReadable(owner.ownerId, threadId as string)

    const threadFilter = scope === 'thread' ? (threadId as string) : undefined
    const latestSequence = input.events.latestEventId(owner.ownerId, threadFilter)
    const cursor = parseEventCursor(params.cursor)
    if (cursor === null) throw new OwnerMethodError('INVALID_EVENT_CURSOR')
    const requestedSequence = cursor?.sequence ?? latestSequence
    const expired = await input.events.isCursorExpired(
      owner.ownerId,
      threadFilter,
      requestedSequence,
    )
    const effectiveResetReason =
      cursor?.epoch !== undefined && cursor.epoch !== makeOwnerEventCursor(owner.ownerId, 0).epoch
        ? 'epoch_changed'
        : (cursor && input.events.isCursorAhead(owner.ownerId, threadFilter, cursor.sequence)) ||
            expired
          ? 'cursor_gap'
          : undefined
    const subscriptionId = existing ? String(requestedSubscriptionId) : crypto.randomUUID()
    // Cursor/ownership checks can await I/O; recheck TTL and capacity after those awaits.
    pruneExpired()
    if (existing && !subscriptions.has(subscriptionId))
      throw new OwnerMethodError('SUBSCRIPTION_EXPIRED')
    if (!existing && subscriptions.size >= MAX_SUBSCRIPTIONS)
      throw new OwnerMethodError('REQUEST_LIMIT_EXCEEDED', true)
    subscriptions.set(subscriptionId, {
      ownerId: owner.ownerId,
      sessionId: owner.sessionId,
      scope,
      ...(scope === 'thread' ? { threadId: threadId as string } : {}),
      expiresAt: now() + SUBSCRIPTION_TTL_MS,
    })
    scheduleExpirationCleanup()
    return {
      result: { subscriptionId, cursor: makeOwnerEventCursor(owner.ownerId, requestedSequence) },
      stream: {
        meta: {
          subscriptionId,
          scope,
          threadId: scope === 'thread' ? threadId : null,
          cursor: makeOwnerEventCursor(owner.ownerId, requestedSequence),
        },
        run: (emit: (event: unknown) => Promise<void>, signal: AbortSignal) =>
          new Promise<void>((resolve, reject) => {
            let stopped = false
            let unsubscribe: (() => unknown) | undefined
            const stop = () => {
              stopped = true
              signal.removeEventListener('abort', abort)
              unsubscribe?.()
            }
            const abort = () => {
              stop()
              resolve()
            }
            const reset = (reason: 'epoch_changed' | 'cursor_gap') => {
              if (stopped) return
              stop()
              void emit({
                method: 'events.reset',
                params: {
                  cursor: makeOwnerEventCursor(
                    owner.ownerId,
                    input.events.latestEventId(owner.ownerId, threadFilter),
                  ),
                  reason,
                },
              }).then(resolve, reject)
            }
            if (signal.aborted) return abort()
            signal.addEventListener('abort', abort, { once: true })
            if (effectiveResetReason) {
              reset(effectiveResetReason)
              return
            }
            const subscribe = input.events.subscribeFrom.bind(input.events)
            void subscribe(
              owner.ownerId,
              threadFilter,
              requestedSequence,
              (event) => {
                if (stopped) return
                void emit({
                  cursor: makeOwnerEventCursor(owner.ownerId, event.id),
                  event: event.message,
                }).catch((error) => {
                  stop()
                  reject(error)
                })
              },
              () => reset('cursor_gap'),
            )
              .then((cleanup) => {
                unsubscribe = cleanup
                if (stopped) cleanup()
                return undefined
              })
              .catch(() => reset('cursor_gap'))
          }),
      },
    }
  }

  return {
    eventsSubscribe,
    async eventsResume(context: OwnerMethodContext, params: Record<string, unknown>) {
      const owner = requireOwner(context)
      pruneExpired()
      if (!safeId(params.subscriptionId) || params.cursor === undefined)
        throw new OwnerMethodError('INVALID_EVENT_CURSOR')
      const subscription = subscriptions.get(params.subscriptionId as string)
      if (
        !subscription ||
        subscription.ownerId !== owner.ownerId ||
        subscription.sessionId !== owner.sessionId ||
        subscription.expiresAt <= now()
      ) {
        throw new OwnerMethodError('SUBSCRIPTION_EXPIRED')
      }
      return eventsSubscribe(context, {
        scope: subscription.scope,
        ...(subscription.threadId ? { threadId: subscription.threadId } : {}),
        cursor: params.cursor,
        subscriptionId: params.subscriptionId,
      })
    },
  }
}
