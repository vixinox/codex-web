import { asc, desc, and, count, eq, gt, isNotNull, lte, max, min } from 'drizzle-orm'
import { domainEvent } from '../db/schema.js'
import type { Database } from '../database.js'
import type { EventHubSnapshot } from './event-hub.js'
import { parseDomainEventEnvelope, type DomainEventEnvelope } from '@codex-web/protocol/owner'
import { log } from '../logger.js'

const THREAD_EVENT_LIMIT = 1_000

export class SqliteEventStore {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  async load(): Promise<EventHubSnapshot> {
    // EventHub replays a bounded window; loading the entire historical table
    // made restart time grow without bound despite the in-memory cap.
    const [sequence] = await this.db.select({ maxId: max(domainEvent.id) }).from(domainEvent)
    const rows = await this.db
      .select()
      .from(domainEvent)
      .where(isNotNull(domainEvent.threadId))
      .orderBy(desc(domainEvent.id))
      .limit(500)
    const events: EventHubSnapshot['events'] = {}
    const rejected = rejectionTracker()
    let nextId = Number(sequence?.maxId ?? 0) + 1
    for (const row of rows.reverse()) {
      const message = parseStoredMessage(row.payload, row.id, row.type, rejected.reject)
      if (!message) continue
      const list = events[row.ownerId] ?? (events[row.ownerId] = [])
      list.push({ id: row.id, message })
    }
    rejected.log('restore')
    for (const list of Object.values(events))
      if (list.length > 500) list.splice(0, list.length - 500)
    return { nextId, events }
  }

  async loadThread(
    userId: string,
    threadId: string,
  ): Promise<Array<{ id: number; message: DomainEventEnvelope }>> {
    const rows = await this.db
      .select()
      .from(domainEvent)
      .where(and(eq(domainEvent.ownerId, userId), eq(domainEvent.threadId, threadId)))
      .orderBy(desc(domainEvent.id))
      .limit(THREAD_EVENT_LIMIT)
    const rejected = rejectionTracker()
    const events = rows.reverse().flatMap((row) => {
      const message = parseStoredMessage(row.payload, row.id, row.type, rejected.reject)
      return message ? [{ id: row.id, message }] : []
    })
    rejected.log('thread-history')
    return events
  }

  async append(userId: string, event: { id: number; message: DomainEventEnvelope }) {
    const threadId = event.message.threadId
    if (!threadId) throw new Error('Thread event persistence requires threadId')
    await this.db.insert(domainEvent).values({
      id: event.id,
      ownerId: userId,
      threadId,
      type: event.message.type,
      payload: event.message,
    })
    if (threadId) await this.retainThread(userId, threadId)
  }

  async loadAfter(userId: string, afterId: number, filterThreadId?: string) {
    if (!filterThreadId) return { events: [], scannedThrough: afterId, hasMore: false }
    const rows = await this.db
      .select()
      .from(domainEvent)
      .where(
        and(
          eq(domainEvent.ownerId, userId),
          eq(domainEvent.threadId, filterThreadId),
          gt(domainEvent.id, afterId),
        ),
      )
      .orderBy(asc(domainEvent.id))
      .limit(500)
    const rejected = rejectionTracker()
    const events = rows.flatMap((row) => {
      const message = parseStoredMessage(row.payload, row.id, row.type, rejected.reject)
      return message ? [{ id: row.id, message }] : []
    })
    rejected.log('replay')
    return {
      events,
      scannedThrough: rows.at(-1)?.id ?? afterId,
      hasMore: rows.length === 500,
    }
  }

  async cursorExpired(userId: string, filterThreadId: string | undefined, afterId: number) {
    if (!filterThreadId) return false
    const [result] = await this.db
      .select({ count: count(), earliestId: min(domainEvent.id) })
      .from(domainEvent)
      .where(and(eq(domainEvent.ownerId, userId), eq(domainEvent.threadId, filterThreadId)))
    return (
      Number(result?.count ?? 0) >= THREAD_EVENT_LIMIT &&
      result?.earliestId !== null &&
      result?.earliestId !== undefined &&
      afterId < result.earliestId - 1
    )
  }

  async retainPerThread(limit = THREAD_EVENT_LIMIT) {
    const threads = await this.db
      .select({ ownerId: domainEvent.ownerId, threadId: domainEvent.threadId })
      .from(domainEvent)
      .where(isNotNull(domainEvent.threadId))
      .groupBy(domainEvent.ownerId, domainEvent.threadId)
    for (const thread of threads)
      if (thread.threadId) await this.retainThread(thread.ownerId, thread.threadId, limit)
  }

  private async retainThread(userId: string, threadId: string, limit = THREAD_EVENT_LIMIT) {
    const cutoff = await this.db
      .select({ id: domainEvent.id })
      .from(domainEvent)
      .where(and(eq(domainEvent.ownerId, userId), eq(domainEvent.threadId, threadId)))
      .orderBy(desc(domainEvent.id))
      .offset(limit)
      .limit(1)
    const id = cutoff[0]?.id
    if (id !== undefined)
      await this.db
        .delete(domainEvent)
        .where(
          and(
            eq(domainEvent.ownerId, userId),
            eq(domainEvent.threadId, threadId),
            lte(domainEvent.id, id),
          ),
        )
  }
}

function parseStoredMessage(
  value: unknown,
  id: number,
  type: string,
  onRejected: (reason: string) => void,
): DomainEventEnvelope | undefined {
  const parsed = parseDomainEventEnvelope(value)
  if (!parsed.ok || parsed.event.eventId !== id || parsed.event.type !== type) {
    const reason = parsed.ok ? 'STORED_EVENT_METADATA_MISMATCH' : parsed.error.code
    onRejected(reason)
    return undefined
  }
  return parsed.event
}

function rejectionTracker() {
  const counts = new Map<string, number>()
  return {
    reject(reason: string) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
    },
    log(scope: string) {
      const count = [...counts.values()].reduce((total, value) => total + value, 0)
      if (count === 0) return
      const reasons = [...counts]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, rejected]) => `${reason}:${rejected}`)
        .join(',')
      log.warn(`Stored domain events rejected (scope=${scope} count=${count} reasons=${reasons})`)
    },
  }
}
