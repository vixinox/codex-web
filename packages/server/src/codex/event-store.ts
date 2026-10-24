import { asc, desc, and, count, eq, gt, isNotNull, lte, min } from 'drizzle-orm'
import { codexEvent } from '../db/schema.js'
import type { Database } from '../database.js'
import type { EventHubSnapshot } from './event-hub.js'
import { projectNativeMessage, type NativeCodexMessage } from './native-protocol.js'

const THREAD_EVENT_LIMIT = 1_000

export class PostgresEventStore {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  async load(): Promise<EventHubSnapshot> {
    // EventHub replays a bounded window; loading the entire historical table
    // made restart time grow without bound despite the in-memory cap.
    const rows = await this.db.select().from(codexEvent).orderBy(desc(codexEvent.id)).limit(500)
    const events: EventHubSnapshot['events'] = {}
    let nextId = 1
    for (const row of rows.reverse()) {
      const projected = projectNativeMessage(row.message)
      if (!projected.ok) continue
      const list = events[row.userId] ?? (events[row.userId] = [])
      list.push({ id: row.id, message: projected.value })
      nextId = Math.max(nextId, row.id + 1)
    }
    for (const list of Object.values(events))
      if (list.length > 500) list.splice(0, list.length - 500)
    return { nextId, events }
  }

  async loadThread(
    userId: string,
    threadId: string,
  ): Promise<Array<{ id: number; message: NativeCodexMessage }>> {
    const rows = await this.db
      .select()
      .from(codexEvent)
      .where(and(eq(codexEvent.userId, userId), eq(codexEvent.threadId, threadId)))
      .orderBy(desc(codexEvent.id))
      .limit(THREAD_EVENT_LIMIT)
    return rows.reverse().flatMap((row) => {
      const projected = projectNativeMessage(row.message)
      return projected.ok ? [{ id: row.id, message: projected.value }] : []
    })
  }

  async append(userId: string, event: { id: number; message: NativeCodexMessage }) {
    const projected = projectNativeMessage(event.message)
    if (!projected.ok) return
    const threadId = messageThreadId(projected.value)
    await this.db.insert(codexEvent).values({
      id: event.id,
      userId,
      threadId,
      message: projected.value,
    })
    if (threadId) await this.retainThread(userId, threadId)
  }

  async loadAfter(userId: string, afterId: number, filterThreadId?: string) {
    const rows = await this.db
      .select()
      .from(codexEvent)
      .where(
        filterThreadId
          ? and(
              eq(codexEvent.userId, userId),
              eq(codexEvent.threadId, filterThreadId),
              gt(codexEvent.id, afterId),
            )
          : and(eq(codexEvent.userId, userId), gt(codexEvent.id, afterId)),
      )
      .orderBy(asc(codexEvent.id))
      .limit(500)
    return rows.flatMap((row) => {
      const projected = projectNativeMessage(row.message)
      return projected.ok ? [{ id: row.id, message: projected.value }] : []
    })
  }

  async cursorExpired(userId: string, filterThreadId: string | undefined, afterId: number) {
    if (filterThreadId) {
      const [result] = await this.db
        .select({ count: count(), earliestId: min(codexEvent.id) })
        .from(codexEvent)
        .where(and(eq(codexEvent.userId, userId), eq(codexEvent.threadId, filterThreadId)))
      return (
        Number(result?.count ?? 0) >= THREAD_EVENT_LIMIT &&
        result?.earliestId !== null &&
        result?.earliestId !== undefined &&
        afterId < result.earliestId - 1
      )
    }

    const threads = await this.db
      .select({ threadId: codexEvent.threadId, count: count(), earliestId: min(codexEvent.id) })
      .from(codexEvent)
      .where(and(eq(codexEvent.userId, userId), isNotNull(codexEvent.threadId)))
      .groupBy(codexEvent.threadId)
    return threads.some(
      (thread) =>
        Number(thread.count) >= THREAD_EVENT_LIMIT &&
        thread.earliestId !== null &&
        afterId < thread.earliestId - 1,
    )
  }

  async retainPerThread(limit = THREAD_EVENT_LIMIT) {
    const threads = await this.db
      .select({ userId: codexEvent.userId, threadId: codexEvent.threadId })
      .from(codexEvent)
      .where(isNotNull(codexEvent.threadId))
      .groupBy(codexEvent.userId, codexEvent.threadId)
    for (const thread of threads)
      if (thread.threadId) await this.retainThread(thread.userId, thread.threadId, limit)
  }

  private async retainThread(userId: string, threadId: string, limit = THREAD_EVENT_LIMIT) {
    const cutoff = await this.db
      .select({ id: codexEvent.id })
      .from(codexEvent)
      .where(and(eq(codexEvent.userId, userId), eq(codexEvent.threadId, threadId)))
      .orderBy(desc(codexEvent.id))
      .offset(limit)
      .limit(1)
    const id = cutoff[0]?.id
    if (id !== undefined)
      await this.db
        .delete(codexEvent)
        .where(
          and(
            eq(codexEvent.userId, userId),
            eq(codexEvent.threadId, threadId),
            lte(codexEvent.id, id),
          ),
        )
  }
}

function messageThreadId(message: NativeCodexMessage) {
  const params = message.params
  if (!params) return undefined
  if (typeof params.threadId === 'string') return params.threadId
  const thread = params.thread
  if (thread && typeof thread === 'object' && !Array.isArray(thread)) {
    const id = (thread as Record<string, unknown>).id
    if (typeof id === 'string') return id
  }
  const turn = params.turn
  if (turn && typeof turn === 'object' && !Array.isArray(turn)) {
    const id = (turn as Record<string, unknown>).threadId
    if (typeof id === 'string') return id
  }
  return undefined
}
