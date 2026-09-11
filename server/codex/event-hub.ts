import type { NativeCodexMessage } from './native-protocol.js'
import { projectNativeMessage, record } from './native-protocol.js'

type StoredEvent = { id: number; message: NativeCodexMessage }
export type EventHubSnapshot = { nextId: number; events: Record<string, StoredEvent[]> }
export type EventStore = {
  append(userId: string, event: StoredEvent): Promise<void>
  loadThread?(userId: string, threadId: string): Promise<StoredEvent[]>
}
export type ThreadRuntimeStatus = {
  status: 'idle' | 'inProgress' | 'completed' | 'failed'
  activeTurnId: string | null
}

function threadId(message: NativeCodexMessage): string | undefined {
  const params = message.params
  if (!record(params)) return undefined
  const value = params.threadId
  if (typeof value === 'string') return value
  const thread = params.thread
  if (record(thread) && typeof thread.id === 'string') return thread.id
  const turn = params.turn
  return record(turn) && typeof turn.threadId === 'string' ? turn.threadId : undefined
}

export class EventHub {
  private store?: EventStore
  private nextId = 1
  private readonly events = new Map<string, StoredEvent[]>()
  private readonly listeners = new Map<string, Set<(event: StoredEvent) => void>>()
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
    // A publish is committed to memory only after its durable append succeeds.
    // Synchronize with writes that were already queued when history was requested
    // so a just-observed command cannot disappear from an immediate Thread read.
    await this.pendingWrite
    const stored = this.events.get(userId) ?? []
    const memory = stored.filter((event) => threadId(event.message) === requestedThreadId)
    if (!this.store?.loadThread) return memory.map(cloneEvent)
    const persisted = await this.store.loadThread(userId, requestedThreadId)
    const byId = new Map<number, StoredEvent>()
    for (const event of [...persisted, ...memory]) byId.set(event.id, event)
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
      for (const event of bounded) maxId = Math.max(maxId, event.id)
      events.set(
        userId,
        bounded.map((event) => ({ id: event.id, message: structuredClone(event.message) })),
      )
    }
    this.events.clear()
    for (const [userId, values] of events) this.events.set(userId, values)
    this.nextId = Math.max(snapshot.nextId, maxId + 1)
  }

  publish(userId: string, message: unknown): Promise<void> {
    const projected = projectNativeMessage(message)
    const safeMessage: NativeCodexMessage = projected.ok
      ? projected.value
      : { method: 'webcodex/protocol-error', params: { code: projected.code } }
    const event = { id: this.nextId++, message: safeMessage }
    if (!this.store) {
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

  publishWithId(userId: string, id: number, message: unknown): Promise<void> {
    const projected = projectNativeMessage(message)
    const safeMessage: NativeCodexMessage = projected.ok
      ? projected.value
      : { method: 'webcodex/protocol-error', params: { code: projected.code } }
    this.nextId = Math.max(this.nextId, id + 1)
    this.commit(userId, { id, message: safeMessage })
    return Promise.resolve()
  }

  private commit(userId: string, event: StoredEvent) {
    const stored = this.events.get(userId) ?? []
    stored.push(event)
    if (stored.length > 500) stored.shift()
    this.events.set(userId, stored)
    for (const listener of this.listeners.get(userId) ?? []) listener(event)
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

  threadRuntimeStatus(userId: string, requestedThreadId: string): ThreadRuntimeStatus {
    let status: ThreadRuntimeStatus = { status: 'idle', activeTurnId: null }
    for (const event of this.events.get(userId) ?? []) {
      if (threadId(event.message) !== requestedThreadId) continue
      const params = event.message.params
      if (!params || typeof params !== 'object' || Array.isArray(params)) continue
      const record = params
      const turn = record.turn
      const turnId =
        typeof record.turnId === 'string'
          ? record.turnId
          : turn && typeof turn === 'object' && !Array.isArray(turn)
            ? typeof (turn as Record<string, unknown>).id === 'string'
              ? ((turn as Record<string, unknown>).id as string)
              : null
            : null
      if (event.message.method === 'turn/started') {
        status = { status: 'inProgress', activeTurnId: turnId }
      } else if (event.message.method === 'turn/completed') {
        status = { status: 'completed', activeTurnId: null }
      } else if (event.message.method === 'turn/failed' || event.message.method === 'error') {
        status = { status: 'failed', activeTurnId: null }
      } else if (event.message.method === 'thread/status/changed') {
        const value =
          record.status && typeof record.status === 'object' && !Array.isArray(record.status)
            ? (record.status as Record<string, unknown>).type
            : undefined
        if (value === 'active') status = { status: 'inProgress', activeTurnId: turnId }
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
      if (replaying || flushing) pendingLive.push(event)
      else listener(event)
    }
    const listeners = this.listeners.get(userId) ?? new Set()
    listeners.add(wrapped)
    this.listeners.set(userId, listeners)
    for (const event of replay) if (event.id > afterId && matches(event)) listener(event)
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
