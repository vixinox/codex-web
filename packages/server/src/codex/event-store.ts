import { asc, desc, and, count, eq, gt, isNotNull, lte, min } from 'drizzle-orm'
import { domainEvent } from '../db/schema.js'
import type { Database } from '../database.js'
import type { EventHubSnapshot } from './event-hub.js'
import type { DomainEventEnvelope } from './domain-events.js'

const THREAD_EVENT_LIMIT = 1_000

export class SqliteEventStore {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  async load(): Promise<EventHubSnapshot> {
    // EventHub replays a bounded window; loading the entire historical table
    // made restart time grow without bound despite the in-memory cap.
    const rows = await this.db.select().from(domainEvent).orderBy(desc(domainEvent.id)).limit(500)
    const events: EventHubSnapshot['events'] = {}
    let nextId = 1
    for (const row of rows.reverse()) {
      const message = row.payload as DomainEventEnvelope
      const list = events[row.ownerId] ?? (events[row.ownerId] = [])
      if (!message || typeof message.type !== 'string') continue
      list.push({ id: row.id, message: { ...message, eventId: row.id } })
      nextId = Math.max(nextId, row.id + 1)
    }
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
    return rows.reverse().map((row) => ({
      id: row.id,
      message: { ...(row.payload as DomainEventEnvelope), eventId: row.id },
    }))
  }

  async append(userId: string, event: { id: number; message: DomainEventEnvelope }) {
    const threadId = event.message.threadId ?? null
    await this.db.insert(domainEvent).values({
      id: event.id,
      ownerId: userId,
      threadId,
      type: event.message.type,
      schemaVersion: event.message.schemaVersion,
      payload: event.message,
    })
    if (threadId) await this.retainThread(userId, threadId)
  }

  async loadAfter(userId: string, afterId: number, filterThreadId?: string) {
    const rows = await this.db
      .select()
      .from(domainEvent)
      .where(
        filterThreadId
          ? and(
              eq(domainEvent.ownerId, userId),
              eq(domainEvent.threadId, filterThreadId),
              gt(domainEvent.id, afterId),
            )
          : and(eq(domainEvent.ownerId, userId), gt(domainEvent.id, afterId)),
      )
      .orderBy(asc(domainEvent.id))
      .limit(500)
    return rows.map((row) => ({
      id: row.id,
      message: { ...(row.payload as DomainEventEnvelope), eventId: row.id },
    }))
  }

  async cursorExpired(userId: string, filterThreadId: string | undefined, afterId: number) {
    if (filterThreadId) {
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

    const threads = await this.db
      .select({ threadId: domainEvent.threadId, count: count(), earliestId: min(domainEvent.id) })
      .from(domainEvent)
      .where(and(eq(domainEvent.ownerId, userId), isNotNull(domainEvent.threadId)))
      .groupBy(domainEvent.threadId)
    return threads.some(
      (thread) =>
        Number(thread.count) >= THREAD_EVENT_LIMIT &&
        thread.earliestId !== null &&
        afterId < thread.earliestId - 1,
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
