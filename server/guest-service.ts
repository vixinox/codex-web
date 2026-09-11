import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import {
  guest,
  guestDailyUsage,
  guestEvent,
  guestGlobalDailyUsage,
  guestThread,
  guestTurnJob,
  session,
} from '../src/lib/db/schema.js'
import type { GuestCodexManager } from './guest-manager.js'
import type { Database } from './database.js'
import type { ServerConfig } from './config.js'
import {
  projectNativeMessage,
  projectNativeThread,
  record,
  type NativeCodexMessage,
} from './codex/native-protocol.js'

const ACTIVE_JOB_STATES = ['queued', 'running'] as const
const GUEST_MODELS = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'])
const GUEST_EFFORTS = new Set(['low', 'medium'])

export type GuestIdentity = { id: string; userId: string; expiresAt: Date }
export type GuestThreadRecord = {
  id: string
  nativeThreadId: string
  title: string
  updatedAt: Date
}

export class GuestService {
  private readonly db: Database
  private readonly config: ServerConfig
  private readonly manager: GuestCodexManager
  private readonly hydrated = new Set<string>()
  /** Tokens the App Server reported for each in-flight native turn. */
  private readonly turnTokens = new Map<string, number>()
  private eventIdCounter: number | null = null
  private eventIdInit: Promise<void> | null = null

  constructor(db: Database, config: ServerConfig, manager: GuestCodexManager) {
    if (!config.guest) throw new Error('Guest configuration is required')
    this.db = db
    this.config = config
    this.manager = manager
  }

  async recover() {
    const interrupted = await this.db
      .select({
        id: guestTurnJob.id,
        guestId: guestTurnJob.guestId,
        reservedTokens: guestTurnJob.reservedTokens,
        usageDate: guestTurnJob.usageDate,
      })
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'running'))
    for (const job of interrupted)
      await this.settle({ ...job, actualTokens: 0 }, 'interrupted', 0, 'Guest runtime restarted')
    await this.dispatchNext()
  }

  runtime() {
    return this.manager.getRuntime()
  }

  async subscribe(
    guestId: string,
    guestThreadId: string | undefined,
    afterId: number,
    listener: (event: { id: number; message: Record<string, unknown> }) => void,
  ) {
    if (guestThreadId) await this.hydrateEvents(guestId, guestThreadId)
    return this.manager.events.subscribe(guestId, guestThreadId, afterId, listener)
  }

  async startSession(userId: string) {
    const identity = await this.createIdentity(userId)
    return { identity }
  }

  async session(userId: string | undefined) {
    if (!userId) return null
    const [record] = await this.db
      .select({
        id: guest.id,
        userId: guest.userId,
        expiresAt: guest.expiresAt,
        deletedAt: guest.deletedAt,
      })
      .from(guest)
      .where(eq(guest.userId, userId))
    if (!record || record.deletedAt || record.expiresAt.getTime() <= Date.now()) {
      if (record && !record.deletedAt) await this.revoke(record.id)
      return null
    }
    return {
      id: record.id,
      userId: record.userId,
      expiresAt: record.expiresAt,
    } satisfies GuestIdentity
  }

  async reset(userId: string) {
    const current = await this.session(userId)
    if (current) await this.revoke(current.id)
    return this.startSession(userId)
  }

  async revoke(guestId: string) {
    const now = new Date()
    const [guestRecord] = await this.db
      .select({ userId: guest.userId })
      .from(guest)
      .where(eq(guest.id, guestId))
    const active = await this.db
      .select({
        id: guestTurnJob.id,
        guestId: guestTurnJob.guestId,
        reservedTokens: guestTurnJob.reservedTokens,
        usageDate: guestTurnJob.usageDate,
        nativeTurnId: guestTurnJob.nativeTurnId,
        nativeThreadId: guestThread.nativeThreadId,
      })
      .from(guestTurnJob)
      .innerJoin(guestThread, eq(guestTurnJob.guestThreadId, guestThread.id))
      .where(
        and(
          eq(guestTurnJob.guestId, guestId),
          inArray(guestTurnJob.status, [...ACTIVE_JOB_STATES]),
        ),
      )
    for (const job of active) {
      if (job.nativeTurnId)
        await this.manager.interrupt(job.nativeThreadId, job.nativeTurnId).catch(() => undefined)
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(guest)
        .set({ deletedAt: now })
        .where(and(eq(guest.id, guestId), isNull(guest.deletedAt)))
      await tx
        .update(guestThread)
        .set({ deletedAt: now })
        .where(and(eq(guestThread.guestId, guestId), isNull(guestThread.deletedAt)))
      if (guestRecord?.userId) {
        await tx.delete(session).where(eq(session.userId, guestRecord.userId))
      }
    })
    for (const job of active)
      await this.settle(
        { ...job, actualTokens: 0 },
        'interrupted',
        this.takeTurnTokens(job.nativeTurnId),
        'Guest session ended',
      )
    await this.manager.removeWorkspace(guestId)
  }
  async listThreads(identity: GuestIdentity) {
    const threads = await this.db
      .select({
        id: guestThread.id,
        nativeThreadId: guestThread.nativeThreadId,
        title: guestThread.title,
        updatedAt: guestThread.updatedAt,
      })
      .from(guestThread)
      .where(and(eq(guestThread.guestId, identity.id), isNull(guestThread.deletedAt)))
      .orderBy(sql`${guestThread.updatedAt} desc`)
    const jobs = await this.db
      .select({ threadId: guestTurnJob.guestThreadId, status: guestTurnJob.status })
      .from(guestTurnJob)
      .where(
        and(
          eq(guestTurnJob.guestId, identity.id),
          inArray(guestTurnJob.status, [...ACTIVE_JOB_STATES]),
        ),
      )
    const statusByThread = new Map(jobs.map((job) => [job.threadId, job.status]))
    return threads.map((thread) =>
      Object.assign({}, thread, { status: statusByThread.has(thread.id) ? 'active' : 'idle' }),
    )
  }

  async createThread(identity: GuestIdentity, input: GuestTurnInput) {
    validateTurnInput(input)
    if (input.skillHandles && !this.manager.validateSkillHandles(identity.id, input.skillHandles))
      throw new Error('Selected guest skills are no longer available')
    const workspace = await this.ensureWorkspace(identity.id)
    await this.assertAdmission(identity.id)
    const nativeThreadId = await this.manager.createThread(workspace)
    const id = randomUUID()
    const title = titleFor(input.text)
    await this.db.insert(guestThread).values({ id, guestId: identity.id, nativeThreadId, title })
    const startedTurnId = await this.startTurn(
      identity,
      { id, nativeThreadId, title, updatedAt: new Date() },
      input,
    )
    return { threadId: id, turnId: startedTurnId, projectId: null }
  }

  async getThread(identity: GuestIdentity, guestThreadId: string) {
    const record = await this.thread(identity.id, guestThreadId)
    if (!record) return null
    await this.manager.resumeThread(record.nativeThreadId, await this.ensureWorkspace(identity.id))
    const client = await this.manager.ready()
    const result = await client.request('thread/read', {
      threadId: record.nativeThreadId,
      includeTurns: true,
    })
    const raw = (result as { thread?: unknown }).thread
    const workspace = await this.ensureWorkspace(identity.id)
    const projected = projectNativeThread(raw, workspace)
    if (!projected) throw new Error('Guest runtime returned an invalid thread')
    const history = await this.history(identity.id, guestThreadId)
    return {
      thread: { ...projected, id: guestThreadId, name: record.title },
      eventCursor: history.at(-1)?.id ?? 0,
      historyEvents: history,
    }
  }

  async threadStatus(identity: GuestIdentity, guestThreadId: string) {
    const record = await this.thread(identity.id, guestThreadId)
    if (!record) return null
    const jobs = await this.db
      .select({
        id: guestTurnJob.id,
        nativeTurnId: guestTurnJob.nativeTurnId,
        status: guestTurnJob.status,
      })
      .from(guestTurnJob)
      .where(
        and(
          eq(guestTurnJob.guestThreadId, guestThreadId),
          inArray(guestTurnJob.status, [...ACTIVE_JOB_STATES]),
        ),
      )
      .orderBy(asc(guestTurnJob.createdAt))
      .limit(1)
    const history = await this.history(identity.id, guestThreadId)
    return {
      threadId: guestThreadId,
      projectId: null,
      status: jobs[0]?.status === 'running' ? 'inProgress' : 'idle',
      eventCursor: history.at(-1)?.id ?? 0,
      activeTurnId: jobs[0]?.id ?? null,
    }
  }

  async startThreadTurn(identity: GuestIdentity, guestThreadId: string, input: GuestTurnInput) {
    validateTurnInput(input)
    if (input.skillHandles && !this.manager.validateSkillHandles(identity.id, input.skillHandles))
      throw new Error('Selected guest skills are no longer available')
    const record = await this.thread(identity.id, guestThreadId)
    if (!record) return null
    await this.manager.resumeThread(record.nativeThreadId, await this.ensureWorkspace(identity.id))
    return { turnId: await this.startTurn(identity, record, input) }
  }

  async cancelTurn(identity: GuestIdentity, guestThreadId: string, jobId: string) {
    const record = await this.thread(identity.id, guestThreadId)
    if (!record) return false
    const [job] = await this.db
      .select()
      .from(guestTurnJob)
      .where(
        and(
          eq(guestTurnJob.id, jobId),
          eq(guestTurnJob.guestId, identity.id),
          eq(guestTurnJob.guestThreadId, guestThreadId),
          inArray(guestTurnJob.status, [...ACTIVE_JOB_STATES]),
        ),
      )
    if (!job) return false
    if (job.nativeTurnId)
      await this.manager.interrupt(record.nativeThreadId, job.nativeTurnId).catch(() => undefined)
    await this.settle(job, 'interrupted', this.takeTurnTokens(job.nativeTurnId), 'Turn cancelled')
    await this.dispatchNext()
    return true
  }

  async compact(identity: GuestIdentity, guestThreadId: string) {
    const record = await this.thread(identity.id, guestThreadId)
    if (!record) return false
    await this.manager.resumeThread(record.nativeThreadId, await this.ensureWorkspace(identity.id))
    await this.manager.compact(record.nativeThreadId)
    return true
  }

  async answerUserInput(
    identity: GuestIdentity,
    guestThreadId: string,
    requestId: number | string,
    answers: unknown,
  ) {
    const record = await this.thread(identity.id, guestThreadId)
    if (!record) return false
    await this.manager.respondUserInput(requestId, record.nativeThreadId, answers)
    await this.publish(identity.id, guestThreadId, {
      method: 'webcodex/userInput/answered',
      params: { threadId: guestThreadId, requestId, answers },
    })
    return true
  }

  async capacity(identity: GuestIdentity) {
    const date = utcDate()
    const [personal] = await this.db
      .select()
      .from(guestDailyUsage)
      .where(and(eq(guestDailyUsage.guestId, identity.id), eq(guestDailyUsage.usageDate, date)))
    const [global] = await this.db
      .select()
      .from(guestGlobalDailyUsage)
      .where(eq(guestGlobalDailyUsage.usageDate, date))
    const [jobs] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'running'))
    const [queued] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'queued'))
    return {
      globalDailyTokenLimit: this.config.guest!.globalDailyTokenLimit,
      globalDailyTokenUsed: global?.usedTokens ?? 0,
      globalDailyTokenReserved: global?.reservedTokens ?? 0,
      perGuestDailyTokenLimit: this.config.guest!.perGuestDailyTokenLimit,
      perGuestDailyTokenUsed: personal?.usedTokens ?? 0,
      perGuestDailyTokenReserved: personal?.reservedTokens ?? 0,
      maxActiveThreads: this.config.guest!.maxActiveThreads,
      activeThreads: jobs?.count ?? 0,
      maxQueue: this.config.guest!.maxQueue,
      queuedTurns: queued?.count ?? 0,
      resetAt: new Date(`${nextUtcDate()}T00:00:00.000Z`).toISOString(),
    }
  }

  async globalCapacity() {
    const date = utcDate()
    const [global] = await this.db
      .select()
      .from(guestGlobalDailyUsage)
      .where(eq(guestGlobalDailyUsage.usageDate, date))
    const [jobs] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'running'))
    const [queued] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'queued'))
    return {
      globalDailyTokenLimit: this.config.guest!.globalDailyTokenLimit,
      globalDailyTokenUsed: global?.usedTokens ?? 0,
      globalDailyTokenReserved: global?.reservedTokens ?? 0,
      perGuestDailyTokenLimit: this.config.guest!.perGuestDailyTokenLimit,
      maxActiveThreads: this.config.guest!.maxActiveThreads,
      activeThreads: jobs?.count ?? 0,
      maxQueue: this.config.guest!.maxQueue,
      queuedTurns: queued?.count ?? 0,
      resetAt: new Date(`${nextUtcDate()}T00:00:00.000Z`).toISOString(),
    }
  }

  async ingest(message: Record<string, unknown>) {
    const projected = projectNativeMessage(message)
    if (!projected.ok) return
    // Usage arrives on its own notification, so bank it before the first await: a
    // turn/completed message dispatched later in the same stream then sees it.
    const usageTokens =
      projected.value.method === 'thread/tokenUsage/updated'
        ? turnUsageTokens(projected.value.params?.tokenUsage)
        : undefined
    if (projected.value.method === 'thread/tokenUsage/updated')
      this.recordTurnTokens(projected.value)
    const nativeThreadId = nativeThread(projected.value)
    if (!nativeThreadId) return
    const [record] = await this.db
      .select()
      .from(guestThread)
      .where(and(eq(guestThread.nativeThreadId, nativeThreadId), isNull(guestThread.deletedAt)))
    if (!record) return
    if (usageTokens !== undefined)
      await this.reconcileLateUsage(turnId(projected.value), usageTokens)
    const rewritten = replaceThreadId(projected.value, record.id)
    await this.publish(record.guestId, record.id, rewritten)
    if (['turn/completed', 'turn/failed'].includes(rewritten.method)) {
      const nativeTurnId = turnId(projected.value)
      if (nativeTurnId) {
        const completionTokens = turnUsageTokens(projected.value.params?.tokenUsage)
        const reportedTokens = this.takeTurnTokens(nativeTurnId)
        const tokens = Math.max(reportedTokens, completionTokens ?? 0)
        const [job] = await this.db
          .select()
          .from(guestTurnJob)
          .where(
            and(
              eq(guestTurnJob.nativeTurnId, nativeTurnId),
              inArray(guestTurnJob.status, [...ACTIVE_JOB_STATES]),
            ),
          )
        if (job)
          await this.settle(
            job,
            rewritten.method === 'turn/completed' ? 'completed' : 'failed',
            tokens,
            rewritten.method === 'turn/failed' ? 'Turn failed' : null,
          )
        await this.dispatchNext()
      }
    }
  }

  private async createIdentity(userId: string) {
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + this.config.guest!.leaseTtlHours * 3_600_000)
    await this.db.insert(guest).values({ id, userId, expiresAt })
    try {
      await this.ensureWorkspace(id)
    } catch (error) {
      await this.revoke(id).catch(() => undefined)
      throw error
    }
    return { id, userId, expiresAt } satisfies GuestIdentity
  }

  private async ensureWorkspace(guestId: string) {
    return this.manager.prepareWorkspace(guestId)
  }

  async skills(identity: GuestIdentity) {
    return this.manager.listSkills(identity.id)
  }

  private async thread(guestId: string, id: string): Promise<GuestThreadRecord | null> {
    const [record] = await this.db
      .select({
        id: guestThread.id,
        nativeThreadId: guestThread.nativeThreadId,
        title: guestThread.title,
        updatedAt: guestThread.updatedAt,
      })
      .from(guestThread)
      .where(
        and(
          eq(guestThread.id, id),
          eq(guestThread.guestId, guestId),
          isNull(guestThread.deletedAt),
        ),
      )
    return record ?? null
  }

  private async startTurn(
    identity: GuestIdentity,
    record: GuestThreadRecord,
    input: GuestTurnInput,
  ) {
    const admission = await this.assertAdmission(identity.id)
    const id = randomUUID()
    const reserve = this.config.guest!.maxTokensPerTurn
    await this.reserve(identity.id, reserve)
    await this.db.insert(guestTurnJob).values({
      id,
      guestId: identity.id,
      guestThreadId: record.id,
      status: admission === 'queued' ? 'queued' : 'running',
      reservedTokens: reserve,
      usageDate: utcDate(),
      inputText: input.text.trim(),
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      skillHandles: [...(input.skillHandles ?? [])],
    })
    if (admission === 'queued') return id
    try {
      const nativeTurnId = await this.manager.startTurn(
        record.nativeThreadId,
        input.text.trim(),
        input.model,
        input.reasoningEffort,
        identity.id,
        input.skillHandles,
      )
      await this.db
        .update(guestTurnJob)
        .set({ nativeTurnId, updatedAt: new Date() })
        .where(eq(guestTurnJob.id, id))
      await this.db
        .update(guestThread)
        .set({ updatedAt: new Date() })
        .where(eq(guestThread.id, record.id))
      return id
    } catch (error) {
      const job = {
        id,
        guestId: identity.id,
        reservedTokens: reserve,
        actualTokens: 0,
        usageDate: utcDate(),
      }
      await this.settle(job, 'failed', 0, 'Guest turn could not start')
      await this.dispatchNext()
      throw error
    }
  }

  private async assertAdmission(guestId: string): Promise<'running' | 'queued'> {
    const identity = await this.sessionById(guestId)
    if (!identity) throw new Error('Guest session is unavailable')
    const [total] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(inArray(guestTurnJob.status, [...ACTIVE_JOB_STATES]))
    const [personal] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(
        and(
          eq(guestTurnJob.guestId, guestId),
          inArray(guestTurnJob.status, [...ACTIVE_JOB_STATES]),
        ),
      )
    if ((personal?.count ?? 0) >= this.config.maxActiveTasksPerUser)
      throw new Error('Guest already has an active turn')
    if ((total?.count ?? 0) >= this.config.guest!.maxQueue) throw new Error('Guest queue is full')
    const capacity = await this.capacity(identity)
    if (
      capacity.globalDailyTokenUsed +
        capacity.globalDailyTokenReserved +
        this.config.guest!.maxTokensPerTurn >
        capacity.globalDailyTokenLimit ||
      capacity.perGuestDailyTokenUsed +
        capacity.perGuestDailyTokenReserved +
        this.config.guest!.maxTokensPerTurn >
        capacity.perGuestDailyTokenLimit
    )
      throw new Error('Guest token capacity is exhausted')
    const running = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'running'))
    return (running[0]?.count ?? 0) >= this.config.guest!.maxActiveThreads ? 'queued' : 'running'
  }

  private async reserve(guestId: string, tokens: number) {
    const date = utcDate()
    await this.db.transaction(async (tx) => {
      await tx
        .insert(guestDailyUsage)
        .values({ guestId, usageDate: date, reservedTokens: tokens })
        .onConflictDoUpdate({
          target: [guestDailyUsage.guestId, guestDailyUsage.usageDate],
          set: { reservedTokens: sql`${guestDailyUsage.reservedTokens} + ${tokens}` },
        })
      await tx
        .insert(guestGlobalDailyUsage)
        .values({ usageDate: date, reservedTokens: tokens })
        .onConflictDoUpdate({
          target: guestGlobalDailyUsage.usageDate,
          set: { reservedTokens: sql`${guestGlobalDailyUsage.reservedTokens} + ${tokens}` },
        })
    })
  }

  private async settle(
    job: {
      id: string
      guestId: string
      reservedTokens: number
      actualTokens: number
      usageDate?: string
    },
    status: string,
    actualTokens: number,
    error: string | null,
  ) {
    const date = job.usageDate ?? utcDate()
    await this.db.transaction(async (tx) => {
      await tx
        .update(guestTurnJob)
        .set({ status, actualTokens, error, updatedAt: new Date() })
        .where(eq(guestTurnJob.id, job.id))
      const update = {
        reservedTokens: sql`greatest(0, ${guestDailyUsage.reservedTokens} - ${job.reservedTokens})`,
        usedTokens: sql`${guestDailyUsage.usedTokens} + ${actualTokens}`,
      }
      await tx
        .update(guestDailyUsage)
        .set(update)
        .where(and(eq(guestDailyUsage.guestId, job.guestId), eq(guestDailyUsage.usageDate, date)))
      await tx
        .update(guestGlobalDailyUsage)
        .set({
          reservedTokens: sql`greatest(0, ${guestGlobalDailyUsage.reservedTokens} - ${job.reservedTokens})`,
          usedTokens: sql`${guestGlobalDailyUsage.usedTokens} + ${actualTokens}`,
        })
        .where(eq(guestGlobalDailyUsage.usageDate, date))
    })
  }

  private recordTurnTokens(message: NativeCodexMessage) {
    const nativeTurnId = turnId(message)
    const tokens = turnUsageTokens(message.params?.tokenUsage)
    if (nativeTurnId && tokens !== undefined) this.turnTokens.set(nativeTurnId, tokens)
  }

  private takeTurnTokens(nativeTurnId: string | null | undefined) {
    if (!nativeTurnId) return 0
    const tokens = this.turnTokens.get(nativeTurnId) ?? 0
    this.turnTokens.delete(nativeTurnId)
    return tokens
  }

  private async reconcileLateUsage(nativeTurnId: string | undefined, tokens: number) {
    if (!nativeTurnId) return
    await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(guestTurnJob)
        .where(eq(guestTurnJob.nativeTurnId, nativeTurnId))
      if (!job || !['completed', 'failed', 'interrupted'].includes(job.status)) return
      if (tokens <= job.actualTokens) return
      const delta = tokens - job.actualTokens
      await tx
        .update(guestTurnJob)
        .set({ actualTokens: tokens, updatedAt: new Date() })
        .where(eq(guestTurnJob.id, job.id))
      await tx
        .update(guestDailyUsage)
        .set({ usedTokens: sql`${guestDailyUsage.usedTokens} + ${delta}` })
        .where(
          and(
            eq(guestDailyUsage.guestId, job.guestId),
            eq(guestDailyUsage.usageDate, job.usageDate),
          ),
        )
      await tx
        .update(guestGlobalDailyUsage)
        .set({ usedTokens: sql`${guestGlobalDailyUsage.usedTokens} + ${delta}` })
        .where(eq(guestGlobalDailyUsage.usageDate, job.usageDate))
    })
  }

  private async dispatchNext() {
    const running = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'running'))
    const slots = this.config.guest!.maxActiveThreads - (running[0]?.count ?? 0)
    if (slots <= 0) return
    const queued = await this.db
      .select()
      .from(guestTurnJob)
      .where(eq(guestTurnJob.status, 'queued'))
      .orderBy(asc(guestTurnJob.createdAt))
      .limit(slots)
    for (const job of queued) {
      const [record] = await this.db
        .select()
        .from(guestThread)
        .where(and(eq(guestThread.id, job.guestThreadId), isNull(guestThread.deletedAt)))
      if (!record) {
        await this.settle(job, 'failed', 0, 'Guest thread is unavailable')
        continue
      }
      try {
        if (!job.inputText || !job.model || !job.reasoningEffort) {
          await this.settle(job, 'failed', 0, 'Queued guest turn is invalid')
          continue
        }
        await this.db
          .update(guestTurnJob)
          .set({ status: 'running', updatedAt: new Date() })
          .where(eq(guestTurnJob.id, job.id))
        await this.manager.resumeThread(
          record.nativeThreadId,
          await this.ensureWorkspace(job.guestId),
        )
        const nativeTurnId = await this.manager.startTurn(
          record.nativeThreadId,
          job.inputText,
          job.model,
          job.reasoningEffort,
          job.guestId,
          job.skillHandles,
        )
        await this.db
          .update(guestTurnJob)
          .set({ nativeTurnId, updatedAt: new Date() })
          .where(eq(guestTurnJob.id, job.id))
      } catch {
        await this.settle(job, 'failed', 0, 'Queued guest turn could not start')
      }
    }
  }

  private async publish(guestId: string, guestThreadId: string, message: NativeCodexMessage) {
    const eventId = await this.nextEventId()
    await this.db.insert(guestEvent).values({ id: eventId, guestId, guestThreadId, message })
    await this.manager.events.publishWithId(guestId, eventId, message)
  }

  private async hydrateEvents(guestId: string, guestThreadId: string) {
    const key = `${guestId}:${guestThreadId}`
    if (this.hydrated.has(key)) return
    this.hydrated.add(key)
    const events = await this.history(guestId, guestThreadId)
    for (const event of events)
      await this.manager.events.publishWithId(guestId, event.id, event.message)
  }

  private async history(guestId: string, guestThreadId: string) {
    const events = await this.db
      .select({ id: guestEvent.id, message: guestEvent.message })
      .from(guestEvent)
      .where(and(eq(guestEvent.guestId, guestId), eq(guestEvent.guestThreadId, guestThreadId)))
      .orderBy(asc(guestEvent.id))
      .limit(1000)
    return events.map((event) => ({ id: event.id, message: event.message as NativeCodexMessage }))
  }

  private async nextEventId() {
    if (this.eventIdCounter === null) {
      this.eventIdInit ??= (async () => {
        const [row] = await this.db
          .select({ id: sql<number>`coalesce(max(${guestEvent.id}), 0)` })
          .from(guestEvent)
        this.eventIdCounter = row?.id ?? 0
      })()
      await this.eventIdInit
    }
    this.eventIdCounter = (this.eventIdCounter ?? 0) + 1
    return this.eventIdCounter
  }

  private async sessionById(id: string) {
    const [record] = await this.db
      .select({
        id: guest.id,
        userId: guest.userId,
        expiresAt: guest.expiresAt,
        deletedAt: guest.deletedAt,
      })
      .from(guest)
      .where(eq(guest.id, id))
    return record && !record.deletedAt && record.expiresAt.getTime() > Date.now()
      ? { id: record.id, userId: record.userId, expiresAt: record.expiresAt }
      : null
  }
}

export type GuestTurnInput = {
  text: string
  model: string
  reasoningEffort: string
  collaborationMode?: string
  skillHandles?: readonly string[]
}

function validateTurnInput(input: GuestTurnInput) {
  if (
    !input.text.trim() ||
    input.text.length > 32_000 ||
    !GUEST_MODELS.has(input.model) ||
    !GUEST_EFFORTS.has(input.reasoningEffort) ||
    (input.collaborationMode && !['default', 'plan'].includes(input.collaborationMode))
  )
    throw new Error('Invalid guest turn parameters')
}
function titleFor(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 44 ? `${normalized.slice(0, 44)}…` : normalized
}
function utcDate() {
  return new Date().toISOString().slice(0, 10)
}
function nextUtcDate() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
}
function nativeThread(message: NativeCodexMessage) {
  const params = message.params
  const thread = params?.thread
  return typeof params?.threadId === 'string'
    ? params.threadId
    : thread &&
        typeof thread === 'object' &&
        typeof (thread as Record<string, unknown>).id === 'string'
      ? ((thread as Record<string, unknown>).id as string)
      : undefined
}
function turnId(message: NativeCodexMessage) {
  const turn = message.params?.turn
  return typeof message.params?.turnId === 'string'
    ? message.params.turnId
    : turn && typeof turn === 'object' && typeof (turn as Record<string, unknown>).id === 'string'
      ? ((turn as Record<string, unknown>).id as string)
      : undefined
}
function turnUsageTokens(value: unknown) {
  if (!record(value) || !record(value.last)) return undefined
  const totalTokens = value.last.totalTokens
  return typeof totalTokens === 'number' && Number.isFinite(totalTokens) && totalTokens >= 0
    ? totalTokens
    : undefined
}
function replaceThreadId(message: NativeCodexMessage, guestThreadId: string): NativeCodexMessage {
  const params = structuredClone(message.params ?? {})
  if (typeof params.threadId === 'string') params.threadId = guestThreadId
  if (
    params.thread &&
    typeof params.thread === 'object' &&
    typeof (params.thread as Record<string, unknown>).id === 'string'
  )
    (params.thread as Record<string, unknown>).id = guestThreadId
  if (
    params.turn &&
    typeof params.turn === 'object' &&
    typeof (params.turn as Record<string, unknown>).threadId === 'string'
  )
    (params.turn as Record<string, unknown>).threadId = guestThreadId
  return { ...message, params }
}
