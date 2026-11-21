import type { ConversationChange } from '@codex-web/conversation'
import {
  parseDomainEventEnvelope,
  type DomainEventEnvelope,
  type DomainEventInput,
} from '@codex-web/protocol/owner'
import { log } from '../logger.js'

export type StoredEvent = { id: number; message: DomainEventEnvelope }
export type EventHubSnapshot = { nextId: number; events: Record<string, StoredEvent[]> }
export type EventPage = {
  events: StoredEvent[]
  scannedThrough: number
  hasMore: boolean
  gapAt?: number
}
export type EventStore = {
  append(userId: string, event: StoredEvent): Promise<void>
  loadThread?(
    userId: string,
    threadId: string,
    throughId?: number,
    rejectGaps?: boolean,
  ): Promise<StoredEvent[]>
  loadAfter?(
    userId: string,
    afterId: number,
    filterThreadId?: string,
    throughId?: number,
  ): Promise<EventPage>
  cursorExpired?(
    userId: string,
    filterThreadId: string | undefined,
    afterId: number,
  ): Promise<boolean>
}
function threadId(event: DomainEventEnvelope): string | undefined {
  return event.threadId
}

export class EventHub {
  private store?: EventStore
  private nextId = 1
  private readonly events = new Map<string, StoredEvent[]>()
  private readonly listeners = new Map<string, Set<(event: StoredEvent) => void>>()
  private readonly evictedThrough = new Map<string, number>()
  private readonly failedThrough = new Map<string, number>()
  private readonly gapListeners = new Map<string, Set<(event: StoredEvent) => void>>()
  private settledThrough = 0
  private pendingWrite: Promise<void> = Promise.resolve()
  private writeError: Error | undefined

  constructor(store?: EventStore) {
    this.store = store
  }

  attachStore(store: EventStore) {
    this.store = store
  }

  async restoreFrom(store: { load(): Promise<EventHubSnapshot> }) {
    this.restore(await store.load())
  }

  async flush() {
    await this.pendingWrite
    if (this.writeError) {
      const error = this.writeError
      this.writeError = undefined
      throw error
    }
  }

  isHealthy() {
    return this.writeError === undefined
  }

  snapshot(): EventHubSnapshot {
    return {
      nextId: this.nextId,
      events: Object.fromEntries(
        [...this.events].map(([userId, events]) => [
          userId,
          events.map((event) => ({ id: event.id, message: structuredClone(event.message) })),
        ]),
      ),
    }
  }

  threadHistory(userId: string, requestedThreadId: string) {
    const cut = this.captureThreadHistory(userId, requestedThreadId, false)
    return cut.then(({ history }) => history)
  }

  captureThreadSnapshot(userId: string, requestedThreadId: string) {
    return this.captureThreadHistory(userId, requestedThreadId, true)
  }

  private captureThreadHistory(userId: string, requestedThreadId: string, rejectGaps: boolean) {
    const throughId = this.nextId - 1
    const capture = this.pendingWrite.then(async () => {
      if (rejectGaps && this.hasWriteGap(userId, requestedThreadId, 0))
        throw new Error('Conversation snapshot history is incomplete')
      const history = await this.readThreadHistory(userId, requestedThreadId, throughId, rejectGaps)
      return { history, sequence: history.at(-1)?.id ?? 0 }
    })
    this.pendingWrite = capture.then(
      () => undefined,
      () => undefined,
    )
    return capture
  }

  private async readThreadHistory(
    userId: string,
    requestedThreadId: string,
    throughId: number,
    rejectGaps: boolean,
  ) {
    const stored = this.events.get(userId) ?? []
    const memory = stored.filter(
      (event) => event.id <= throughId && threadId(event.message) === requestedThreadId,
    )
    if (!this.store?.loadThread) return memory.map(cloneEvent)
    const persisted = await this.store.loadThread(userId, requestedThreadId, throughId, rejectGaps)
    const byId = new Map<number, StoredEvent>()
    for (const event of [...persisted, ...memory]) {
      const normalized = normalizeStoredEvent(event)
      if (normalized && event.id <= throughId) byId.set(event.id, normalized)
    }
    return [...byId.values()].sort((left, right) => left.id - right.id).map(cloneEvent)
  }

  restore(snapshot: EventHubSnapshot) {
    if (!snapshot || !Number.isInteger(snapshot.nextId) || snapshot.nextId < 1)
      throw new Error('Invalid event snapshot')
    const events = new Map<string, StoredEvent[]>()
    let maxId = 0
    for (const [userId, values] of Object.entries(snapshot.events ?? {})) {
      if (!Array.isArray(values)) throw new Error('Invalid event snapshot')
      const bounded = values
        .filter(
          (event) =>
            Number.isInteger(event.id) &&
            event.id > 0 &&
            event.message &&
            typeof event.message === 'object',
        )
        .slice(-500)
      const normalized = bounded.flatMap((event) => normalizeStoredEvent(event) ?? [])
      for (const event of bounded) maxId = Math.max(maxId, event.id)
      events.set(userId, normalized)
    }
    this.events.clear()
    for (const [userId, values] of events) this.events.set(userId, values)
    this.nextId = Math.max(snapshot.nextId, maxId + 1)
    this.settledThrough = this.nextId - 1
  }

  publishDomain(userId: string, input: DomainEventInput): Promise<void> {
    const id = this.nextId
    const change =
      input.type === 'conversation.change'
        ? (input.payload.change as ConversationChange)
        : undefined
    const payload = change
      ? { change: { ...change, identity: { ...change.identity, applicationSequence: id } } }
      : input.payload
    const event = { id, message: { ...input, payload, eventId: id } }
    if (!parseDomainEventEnvelope(event.message).ok) {
      this.nextId++
      const error = new Error('Invalid or oversized Owner event')
      this.recordGap(userId, event, error)
      return Promise.reject(error)
    }
    this.nextId++
    const store = this.store
    if (!store) {
      this.commit(userId, event)
      return Promise.resolve()
    }
    const delivery = this.pendingWrite.then(async () => {
      if (event.message.type === 'conversation.change') {
        try {
          await store.append(userId, event)
        } catch (error) {
          this.recordGap(userId, event, error instanceof Error ? error : new Error(String(error)))
          return undefined
        }
        this.writeError = undefined
      }
      this.commit(userId, event)
      return undefined
    })
    this.pendingWrite = delivery.catch(() => {
      log.warn('codex.event.delivery-failed')
    })
    return this.pendingWrite
  }

  publishConversationChange(userId: string, conversationId: string, change: ConversationChange) {
    return this.publishDomain(userId, {
      type: 'conversation.change',
      runtime: 'codex',
      threadId: conversationId,
      ...(change.type === 'turn.upserted'
        ? { turnId: change.turn.id }
        : 'turnId' in change
          ? { turnId: change.turnId }
          : {}),
      ...(change.type === 'activity.upserted'
        ? { itemId: change.activity.id }
        : change.type === 'message.upserted'
          ? { itemId: change.message.id }
          : {}),
      createdAt: change.identity.receivedAt,
      payload: { change },
    })
  }

  private recordGap(userId: string, event: StoredEvent, error: Error) {
    this.writeError = error
    this.settledThrough = Math.max(this.settledThrough, event.id)
    this.failedThrough.set(eventScopeKey(userId, undefined), event.id)
    this.failedThrough.set(eventScopeKey(userId, threadId(event.message)), event.id)
    for (const listener of this.gapListeners.get(userId) ?? []) listener(event)
  }

  private commit(userId: string, event: StoredEvent) {
    this.settledThrough = Math.max(this.settledThrough, event.id)
    const stored = this.events.get(userId) ?? []
    stored.push(event)
    if (stored.length > 500) {
      const [evicted] = stored.splice(0, stored.length - 500)
      if (evicted) {
        for (const scope of [undefined, threadId(evicted.message)]) {
          const key = eventScopeKey(userId, scope)
          this.evictedThrough.set(key, Math.max(this.evictedThrough.get(key) ?? 0, evicted.id))
        }
      }
    }
    this.events.set(userId, stored)
    for (const listener of this.listeners.get(userId) ?? []) listener(cloneEvent(event))
  }

  latestEventId(userId: string, filterThreadId?: string) {
    return (this.events.get(userId) ?? []).reduce(
      (latest, event) =>
        !filterThreadId || threadId(event.message) === filterThreadId
          ? Math.max(latest, event.id)
          : latest,
      0,
    )
  }

  isCursorAhead(userId: string, filterThreadId: string | undefined, sequence: number) {
    return sequence > (filterThreadId ? this.settledThrough : this.latestEventId(userId))
  }

  earliestEventId(userId: string, filterThreadId?: string) {
    let earliest = 0
    for (const event of this.events.get(userId) ?? []) {
      if (filterThreadId && threadId(event.message) !== filterThreadId) continue
      if (earliest === 0 || event.id < earliest) earliest = event.id
    }
    return earliest
  }

  cursorExpired(userId: string, filterThreadId: string | undefined, afterId: number) {
    return afterId < (this.evictedThrough.get(eventScopeKey(userId, filterThreadId)) ?? 0)
  }

  async isCursorExpired(userId: string, filterThreadId: string | undefined, afterId: number) {
    await this.pendingWrite
    if (this.hasWriteGap(userId, filterThreadId, afterId)) return true
    if (filterThreadId && this.store?.cursorExpired)
      return this.store.cursorExpired(userId, filterThreadId, afterId)
    return this.cursorExpired(userId, filterThreadId, afterId)
  }

  private hasWriteGap(userId: string, filterThreadId: string | undefined, afterId: number) {
    return afterId < (this.failedThrough.get(eventScopeKey(userId, filterThreadId)) ?? 0)
  }

  async subscribeFrom(
    userId: string,
    filterThreadId: string | undefined,
    afterId: number,
    listener: (event: StoredEvent) => void,
    onGap?: () => void,
  ) {
    await this.pendingWrite
    if (this.hasWriteGap(userId, filterThreadId, afterId)) {
      onGap?.()
      return () => {}
    }
    const matchesThread = (event: StoredEvent) =>
      !filterThreadId || threadId(event.message) === filterThreadId
    const replayThrough = this.settledThrough
    const matchesReplay = (event: StoredEvent) =>
      matchesThread(event) && event.id > afterId && event.id <= replayThrough
    let replaying = true
    let flushing = false
    let stopped = false
    let lastDeliveredId = afterId
    const pendingLive: StoredEvent[] = []
    const wrapped = (event: StoredEvent) => {
      if (!matchesThread(event) || event.id <= Math.max(replayThrough, lastDeliveredId)) return
      if (replaying || flushing) {
        if (pendingLive.length >= 1000) {
          reset()
          return
        }
        pendingLive.push(cloneEvent(event))
      } else deliver([event], false)
    }
    const listeners = this.listeners.get(userId) ?? new Set()
    const gapListeners = this.gapListeners.get(userId) ?? new Set()
    const onWriteFailure = (event: StoredEvent) => {
      if (matchesThread(event)) reset()
    }
    const unsubscribe = () => {
      if (stopped) return
      stopped = true
      listeners.delete(wrapped)
      if (listeners.size === 0) this.listeners.delete(userId)
      gapListeners.delete(onWriteFailure)
      if (gapListeners.size === 0) this.gapListeners.delete(userId)
      pendingLive.length = 0
    }
    const reset = () => {
      if (stopped) return
      unsubscribe()
      onGap?.()
    }
    const deliver = (events: StoredEvent[], replay: boolean) => {
      for (const event of events.sort((left, right) => left.id - right.id)) {
        if (
          stopped ||
          event.id <= lastDeliveredId ||
          (replay ? event.id > replayThrough : event.id <= replayThrough)
        )
          continue
        lastDeliveredId = event.id
        listener(cloneEvent(event))
      }
    }

    listeners.add(wrapped)
    this.listeners.set(userId, listeners)
    gapListeners.add(onWriteFailure)
    this.gapListeners.set(userId, gapListeners)
    const memory = (this.events.get(userId) ?? []).filter(matchesReplay)
    try {
      if (this.store?.loadAfter) {
        let cursor = afterId
        while (cursor < replayThrough) {
          if (stopped) break
          const page = await this.store.loadAfter(userId, cursor, filterThreadId, replayThrough)
          if (stopped) break
          let gapAt = page.gapAt ?? Infinity
          const events = page.events.flatMap((event) => {
            if (!matchesReplay(event)) return []
            const normalized = normalizeStoredEvent(event)
            if (!normalized) gapAt = Math.min(gapAt, event.id)
            return normalized ? [normalized] : []
          })
          const through = page.hasMore ? page.scannedThrough : replayThrough
          deliver(
            [...events, ...memory.filter((event) => event.id <= through)].filter(
              (event) => event.id < gapAt,
            ),
            true,
          )
          if (gapAt <= replayThrough || (page.hasMore && through <= cursor)) {
            reset()
            break
          }
          cursor = through
        }
      } else {
        deliver(memory, true)
      }
      replaying = false
      flushing = true
      while (pendingLive.length) {
        if (stopped) break
        deliver(pendingLive.splice(0), false)
      }
      flushing = false
      return unsubscribe
    } catch (error) {
      unsubscribe()
      throw error
    }
  }

  subscribe(
    userId: string,
    filterThreadId: string | undefined,
    afterId: number,
    listener: (event: StoredEvent) => void,
  ) {
    const matches = (event: StoredEvent) =>
      !filterThreadId || threadId(event.message) === filterThreadId
    const replay = [...(this.events.get(userId) ?? [])].sort((left, right) => left.id - right.id)
    const replayThrough = replay.reduce((latest, event) => Math.max(latest, event.id), afterId)
    let replaying = true
    let flushing = false
    const pendingLive: StoredEvent[] = []
    const wrapped = (event: StoredEvent) => {
      if (event.id <= replayThrough || !matches(event)) return
      if (replaying || flushing) pendingLive.push(cloneEvent(event))
      else listener(cloneEvent(event))
    }
    const listeners = this.listeners.get(userId) ?? new Set()
    listeners.add(wrapped)
    this.listeners.set(userId, listeners)
    for (const event of replay)
      if (event.id > afterId && matches(event)) listener(cloneEvent(event))
    replaying = false
    flushing = true
    while (pendingLive.length) listener(pendingLive.shift()!)
    flushing = false
    return () => listeners.delete(wrapped)
  }
}

function cloneEvent(event: StoredEvent): StoredEvent {
  return { id: event.id, message: structuredClone(event.message) }
}

function normalizeStoredEvent(value: { id: number; message: unknown }): StoredEvent | null {
  const parsed = parseDomainEventEnvelope(value.message)
  if (!parsed.ok || parsed.event.eventId !== value.id) {
    const reason = parsed.ok ? 'EVENT_ID_MISMATCH' : parsed.error.code
    log.warn('codex.event.rejected', { reason })
    return null
  }
  return { id: value.id, message: parsed.event }
}

function eventScopeKey(userId: string, filterThreadId: string | undefined) {
  return `${userId}\u0000${filterThreadId ?? '*'}`
}
