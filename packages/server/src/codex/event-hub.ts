import {
  adaptCodexMessage,
  createDomainEvent,
  domainEventThreadId,
  projectDomainEvent,
} from './domain-events.js'
import {
  parseDomainEventEnvelope,
  type DomainEventEnvelope,
  type DomainEventInput,
} from '@codex-web/protocol/owner'
import { log } from '../logger.js'

export type StoredEvent = { id: number; message: DomainEventEnvelope }
export type EventHubSnapshot = { nextId: number; events: Record<string, StoredEvent[]> }
export type EventPage = { events: StoredEvent[]; scannedThrough: number; hasMore: boolean }
export type EventStore = {
  append(userId: string, event: StoredEvent): Promise<void>
  loadThread?(userId: string, threadId: string): Promise<StoredEvent[]>
  loadAfter?(userId: string, afterId: number, filterThreadId?: string): Promise<EventPage>
  cursorExpired?(
    userId: string,
    filterThreadId: string | undefined,
    afterId: number,
  ): Promise<boolean>
}
export type ThreadRuntimeStatus = {
  status: 'idle' | 'inProgress' | 'completed' | 'failed'
  activeTurnId: string | null
}

function threadId(event: DomainEventEnvelope): string | undefined {
  return domainEventThreadId(event)
}

export class EventHub {
  private store?: EventStore
  private nextId = 1
  private readonly events = new Map<string, StoredEvent[]>()
  private readonly listeners = new Map<string, Set<(event: StoredEvent) => void>>()
  private readonly evictedThrough = new Map<string, number>()
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

  async threadHistory(userId: string, requestedThreadId: string) {
    await this.pendingWrite
    const stored = this.events.get(userId) ?? []
    const memory = stored.filter((event) => threadId(event.message) === requestedThreadId)
    if (!this.store?.loadThread) return memory.map(cloneEvent)
    const persisted = await this.store.loadThread(userId, requestedThreadId)
    const byId = new Map<number, StoredEvent>()
    for (const event of [...persisted, ...memory]) {
      const normalized = normalizeStoredEvent(event)
      if (normalized) byId.set(event.id, normalized)
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
  }

  /** Raw Codex input is adapted at this ingress edge before entering the hub. */
  publish(userId: string, value: unknown): Promise<void> {
    return this.publishDomain(userId, toDomainEvent(value))
  }

  publishDomain(userId: string, input: DomainEventInput): Promise<void> {
    const id = this.nextId++
    const event = { id, message: projectDomainEvent({ ...input, eventId: id }) }
    if (!this.store || !threadId(event.message)) {
      this.commit(userId, event)
      return Promise.resolve()
    }
    const write = this.pendingWrite.then(() => this.store!.append(userId, event))
    this.pendingWrite = write
      .then(() => undefined)
      .catch((error: unknown) => {
        this.writeError = error instanceof Error ? error : new Error(String(error))
      })
    return write.then(
      () => {
        this.writeError = undefined
        this.commit(userId, event)
        return undefined
      },
      () => undefined,
    )
  }

  publishWithId(userId: string, id: number, value: unknown): Promise<void> {
    const input = toDomainEvent(value)
    this.nextId = Math.max(this.nextId, id + 1)
    this.commit(userId, { id, message: projectDomainEvent({ ...input, eventId: id }) })
    return Promise.resolve()
  }

  private commit(userId: string, event: StoredEvent) {
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
    if (filterThreadId && this.store?.cursorExpired)
      return this.store.cursorExpired(userId, filterThreadId, afterId)
    return this.cursorExpired(userId, filterThreadId, afterId)
  }

  async subscribeFrom(
    userId: string,
    filterThreadId: string | undefined,
    afterId: number,
    listener: (event: StoredEvent) => void,
  ) {
    await this.pendingWrite
    const matchesThread = (event: StoredEvent) =>
      !filterThreadId || threadId(event.message) === filterThreadId
    const replayThrough = this.latestEventId(userId, filterThreadId)
    const matchesReplay = (event: StoredEvent) =>
      matchesThread(event) && event.id > afterId && event.id <= replayThrough
    let replaying = true
    let flushing = false
    let stopped = false
    let lastDeliveredId = afterId
    const pendingLive: StoredEvent[] = []
    const wrapped = (event: StoredEvent) => {
      if (!matchesThread(event) || event.id <= replayThrough) return
      if (replaying || flushing) {
        if (pendingLive.length >= 1000) throw new Error('Event subscriber replay backlog exceeded')
        pendingLive.push(cloneEvent(event))
      } else listener(cloneEvent(event))
    }
    const listeners = this.listeners.get(userId) ?? new Set()
    listeners.add(wrapped)
    this.listeners.set(userId, listeners)
    const unsubscribe = () => {
      if (stopped) return
      stopped = true
      listeners.delete(wrapped)
      if (listeners.size === 0) this.listeners.delete(userId)
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

    try {
      if (filterThreadId && this.store?.loadAfter) {
        let cursor = afterId
        for (;;) {
          const page = await this.store.loadAfter(userId, cursor, filterThreadId)
          const events = page.events.flatMap((event) => normalizeStoredEvent(event) ?? [])
          deliver(
            events.filter((event) => event.id <= replayThrough),
            true,
          )
          if (!page.hasMore || page.scannedThrough <= cursor) break
          cursor = page.scannedThrough
          if (cursor >= replayThrough) break
        }
      } else {
        deliver((this.events.get(userId) ?? []).filter(matchesReplay).map(cloneEvent), true)
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

  threadRuntimeStatus(userId: string, requestedThreadId: string): ThreadRuntimeStatus {
    let status: ThreadRuntimeStatus = { status: 'idle', activeTurnId: null }
    for (const event of this.events.get(userId) ?? []) {
      if (threadId(event.message) !== requestedThreadId) continue
      const method = event.message.type.startsWith('codex.')
        ? event.message.type.slice('codex.'.length)
        : event.message.type
      const payload = event.message.payload
      const turn = payload.turn
      const turnId =
        event.message.turnId ??
        (typeof payload.turnId === 'string' ? payload.turnId : undefined) ??
        (turn && typeof turn === 'object' && !Array.isArray(turn)
          ? typeof (turn as Record<string, unknown>).id === 'string'
            ? ((turn as Record<string, unknown>).id as string)
            : null
          : null)
      if (method === 'turn/started') status = { status: 'inProgress', activeTurnId: turnId ?? null }
      else if (method === 'turn/completed') status = { status: 'completed', activeTurnId: null }
      else if (method === 'turn/failed' || method === 'error')
        status = { status: 'failed', activeTurnId: null }
      else if (method === 'thread/status/changed') {
        const value =
          payload.status && typeof payload.status === 'object' && !Array.isArray(payload.status)
            ? (payload.status as Record<string, unknown>).type
            : undefined
        if (value === 'active') status = { status: 'inProgress', activeTurnId: turnId ?? null }
        else if (value === 'systemError') status = { status: 'failed', activeTurnId: null }
        else if (value === 'idle' || value === 'notLoaded')
          status = { status: 'idle', activeTurnId: null }
      }
    }
    return status
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

function toDomainEvent(value: unknown): DomainEventInput {
  const adapted = adaptCodexMessage(value)
  if (adapted.kind === 'event' || adapted.kind === 'extension') return adapted.event
  return createDomainEvent('runtime.diagnostic', {
    code: adapted.diagnostic.code,
    method: adapted.diagnostic.method,
    detail: adapted.diagnostic.detail,
  })
}

function cloneEvent(event: StoredEvent): StoredEvent {
  return { id: event.id, message: structuredClone(event.message) }
}

function normalizeStoredEvent(value: { id: number; message: unknown }): StoredEvent | null {
  const parsed = parseDomainEventEnvelope(value.message)
  if (!parsed.ok || parsed.event.eventId !== value.id) {
    const reason = parsed.ok ? 'EVENT_ID_MISMATCH' : parsed.error.code
    log.warn(`Stored domain event rejected (eventId=${value.id} reason=${reason})`)
    return null
  }
  return { id: value.id, message: projectDomainEvent(parsed.event) }
}

function eventScopeKey(userId: string, filterThreadId: string | undefined) {
  return `${userId}\u0000${filterThreadId ?? '*'}`
}
