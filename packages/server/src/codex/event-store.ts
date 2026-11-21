import type { ConversationChange } from '@codex-web/conversation'
import { asc, desc, and, count, eq, gt, lte, max, min, sql } from 'drizzle-orm'
import { conversationEvent } from '../db/schema.js'
import type { Database } from '../database.js'
import type { EventHubSnapshot, EventPage } from './event-hub.js'
import {
  isConversationChange,
  parseDomainEventEnvelope,
  type DomainEventEnvelope,
} from '@codex-web/protocol/owner'
import { log } from '../logger.js'

const THREAD_EVENT_LIMIT = 1_000
const eventColumns = {
  id: conversationEvent.id,
  ownerId: conversationEvent.ownerId,
  conversationId: conversationEvent.conversationId,
  change: sql<string>`cast(${conversationEvent.change} as text)`,
  createdAt: conversationEvent.createdAt,
}

export class SqliteEventStore {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  async load(): Promise<EventHubSnapshot> {
    // EventHub replays a bounded window; loading the entire historical table
    // made restart time grow without bound despite the in-memory cap.
    const [sequence] = await this.db
      .select({ maxId: max(conversationEvent.id) })
      .from(conversationEvent)
    const rows = await this.db
      .select(eventColumns)
      .from(conversationEvent)
      .orderBy(desc(conversationEvent.id))
      .limit(500)
    const events: EventHubSnapshot['events'] = {}
    const rejected = rejectionTracker()
    const nextId = Number(sequence?.maxId ?? 0) + 1
    for (const row of rows.reverse()) {
      const message = parseStoredChange(row, rejected.reject)
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
    throughId = Number.MAX_SAFE_INTEGER,
    rejectGaps = false,
  ): Promise<Array<{ id: number; message: DomainEventEnvelope }>> {
    const rows = await this.db
      .select(eventColumns)
      .from(conversationEvent)
      .where(
        and(
          eq(conversationEvent.ownerId, userId),
          eq(conversationEvent.conversationId, threadId),
          lte(conversationEvent.id, throughId),
        ),
      )
      .orderBy(desc(conversationEvent.id))
      .limit(THREAD_EVENT_LIMIT)
    const rejected = rejectionTracker()
    const events = rows.reverse().flatMap((row) => {
      const message = parseStoredChange(row, rejected.reject)
      if (!message && rejectGaps) throw new Error('Conversation snapshot history is incomplete')
      return message ? [{ id: row.id, message }] : []
    })
    rejected.log('thread-history')
    return events
  }

  async append(userId: string, event: { id: number; message: DomainEventEnvelope }) {
    const { threadId, createdAt, payload } = event.message
    const change = payload.change as ConversationChange | undefined
    if (
      event.message.type !== 'conversation.change' ||
      event.message.eventId !== event.id ||
      !threadId ||
      !change ||
      change.identity?.applicationSequence !== event.id
    )
      throw new Error('Invalid Conversation event identity')
    this.db.transaction((transaction) => {
      transaction
        .insert(conversationEvent)
        .values({
          id: event.id,
          ownerId: userId,
          conversationId: threadId,
          change,
          createdAt,
        })
        .run()
      this.retainThread(userId, threadId, THREAD_EVENT_LIMIT, transaction)
    })
  }

  async loadAfter(
    userId: string,
    afterId: number,
    filterThreadId?: string,
    throughId = Number.MAX_SAFE_INTEGER,
  ): Promise<EventPage> {
    const rows = await this.db
      .select(eventColumns)
      .from(conversationEvent)
      .where(
        and(
          eq(conversationEvent.ownerId, userId),
          filterThreadId === undefined
            ? undefined
            : eq(conversationEvent.conversationId, filterThreadId),
          gt(conversationEvent.id, afterId),
          lte(conversationEvent.id, throughId),
        ),
      )
      .orderBy(asc(conversationEvent.id))
      .limit(500)
    const rejected = rejectionTracker()
    const events: EventPage['events'] = []
    for (const row of rows) {
      const message = parseStoredChange(row, rejected.reject)
      if (!message) {
        rejected.log('replay')
        return {
          events,
          scannedThrough: events.at(-1)?.id ?? afterId,
          hasMore: false,
          gapAt: row.id,
        }
      }
      events.push({ id: row.id, message })
    }
    return {
      events,
      scannedThrough: rows.at(-1)?.id ?? afterId,
      hasMore: rows.length === 500,
    }
  }

  async cursorExpired(userId: string, filterThreadId: string | undefined, afterId: number) {
    if (!filterThreadId) return false
    const [result] = await this.db
      .select({ count: count(), earliestId: min(conversationEvent.id) })
      .from(conversationEvent)
      .where(
        and(
          eq(conversationEvent.ownerId, userId),
          eq(conversationEvent.conversationId, filterThreadId),
        ),
      )
    return (
      Number(result?.count ?? 0) >= THREAD_EVENT_LIMIT &&
      result?.earliestId !== null &&
      result?.earliestId !== undefined &&
      afterId < result.earliestId - 1
    )
  }

  async retainPerThread(limit = THREAD_EVENT_LIMIT) {
    const threads = await this.db
      .select({ ownerId: conversationEvent.ownerId, threadId: conversationEvent.conversationId })
      .from(conversationEvent)
      .groupBy(conversationEvent.ownerId, conversationEvent.conversationId)
    for (const thread of threads) this.retainThread(thread.ownerId, thread.threadId, limit, this.db)
  }

  private retainThread(
    userId: string,
    threadId: string,
    limit: number,
    db: Pick<Database, 'select' | 'delete'>,
  ) {
    const cutoff = db
      .select({ id: conversationEvent.id })
      .from(conversationEvent)
      .where(
        and(eq(conversationEvent.ownerId, userId), eq(conversationEvent.conversationId, threadId)),
      )
      .orderBy(desc(conversationEvent.id))
      .offset(limit)
      .limit(1)
      .get()
    const id = cutoff?.id
    if (id !== undefined)
      db.delete(conversationEvent)
        .where(
          and(
            eq(conversationEvent.ownerId, userId),
            eq(conversationEvent.conversationId, threadId),
            lte(conversationEvent.id, id),
          ),
        )
        .run()
  }
}

function parseStoredChange(
  row: Omit<typeof conversationEvent.$inferSelect, 'change'> & { change: string },
  onRejected: (reason: string) => void,
): DomainEventEnvelope | undefined {
  let change: unknown
  try {
    change = JSON.parse(row.change)
  } catch {
    onRejected('STORED_EVENT_INVALID_JSON')
    return undefined
  }
  if (!isConversationChange(change) || change.identity.applicationSequence !== row.id) {
    onRejected('STORED_EVENT_METADATA_MISMATCH')
    return undefined
  }
  const parsed = parseDomainEventEnvelope({
    eventId: row.id,
    type: 'conversation.change',
    runtime: 'codex',
    threadId: row.conversationId,
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
    createdAt: row.createdAt,
    payload: { change },
  })
  if (!parsed.ok) {
    onRejected(parsed.error.code)
    return undefined
  }
  return parsed.event
}

function rejectionTracker() {
  const counts = new Map<string, number>()
  return {
    reject(this: void, reason: string) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
    },
    log(scope: string) {
      const count = [...counts.values()].reduce((total, value) => total + value, 0)
      if (count === 0) return
      const reasons = [...counts]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([reason, rejected]) => `${reason}:${rejected}`)
        .join(',')
      log.warn('codex.event-store.records-rejected', { scope, count, reasons })
    },
  }
}
