import 'dotenv/config'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { loadServerConfig } from './config.js'
import { createDatabase, type Database } from './database.js'
import { GuestService } from './guest-service.js'
import type { GuestCodexManager } from './guest-manager.js'
import {
  guest,
  guestDailyUsage,
  guestGlobalDailyUsage,
  guestThread,
  guestTurnJob,
  user,
} from '../src/lib/db/schema.js'

const DAY_MS = 86_400_000
const FIRST_TURN_TOKENS = 33_194
const SECOND_TURN_TOKENS = 6_000

test('bills each guest turn from the App Server token usage notification', async (t) => {
  const config = loadServerConfig('guest')
  if (!config.guest) {
    t.skip('guest configuration is not configured')
    return
  }
  const { db, pool } = createDatabase(config)
  const [busy] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(guestTurnJob)
    .where(inArray(guestTurnJob.status, ['queued', 'running']))
  if ((busy?.count ?? 0) > 0) {
    await pool.end()
    t.skip('a guest turn is already active on this database')
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const guestId = randomUUID()
  const userId = `integration-user-${guestId}`
  const guestThreadId = randomUUID()
  const nativeThreadId = `integration-thread-${guestId}`
  const firstTurnId = `integration-turn-1-${guestId}`
  const secondTurnId = `integration-turn-2-${guestId}`
  let globalRowExisted = false
  let globalSnapshot = { usedTokens: 0 }

  try {
    const [existingGlobal] = await db
      .select()
      .from(guestGlobalDailyUsage)
      .where(eq(guestGlobalDailyUsage.usageDate, today))
    globalRowExisted = existingGlobal !== undefined
    if (existingGlobal)
      globalSnapshot = {
        usedTokens: existingGlobal.usedTokens,
      }
    else await db.insert(guestGlobalDailyUsage).values({ usageDate: today })

    await db.insert(user).values({
      id: userId,
      name: 'Guest usage integration',
      email: `${userId}@example.com`,
    })
    await db.insert(guest).values({
      id: guestId,
      userId,
      expiresAt: new Date(Date.now() + DAY_MS),
    })
    await db.insert(guestThread).values({
      id: guestThreadId,
      guestId,
      nativeThreadId,
      title: 'Guest usage integration',
    })
    await insertRunningJob(db, { guestId, guestThreadId, nativeTurnId: firstTurnId, today })

    const service = new GuestService(db, config, {
      events: { publishWithId: async () => undefined },
    } as unknown as GuestCodexManager)
    const identity = { id: guestId, userId, expiresAt: new Date(Date.now() + DAY_MS) }
    const ledger = async () => {
      const [row] = await db
        .select()
        .from(guestDailyUsage)
        .where(and(eq(guestDailyUsage.guestId, guestId), eq(guestDailyUsage.usageDate, today)))
      return row
    }

    // A completion may race ahead of the final usage notification. Late usage is
    // reconciled by delta, while repeated updates for one turn never accumulate.
    await service.ingest(usageEvent(nativeThreadId, firstTurnId, 30_000, 30_000))
    await service.ingest(completedEvent(nativeThreadId, firstTurnId))
    await service.ingest(usageEvent(nativeThreadId, firstTurnId, FIRST_TURN_TOKENS, 49_575))

    assert.equal((await ledger())?.usedTokens, FIRST_TURN_TOKENS)
    assert.equal((await service.capacity(identity)).perGuestDailyTokenUsed, FIRST_TURN_TOKENS)

    // A second turn on the same thread bills its own `last` usage, not the cumulative `total`.
    await insertRunningJob(db, { guestId, guestThreadId, nativeTurnId: secondTurnId, today })
    const cumulative = FIRST_TURN_TOKENS + SECOND_TURN_TOKENS
    await service.ingest(usageEvent(nativeThreadId, secondTurnId, SECOND_TURN_TOKENS, cumulative))
    await service.ingest(completedEvent(nativeThreadId, secondTurnId))

    assert.equal((await ledger())?.usedTokens, cumulative)

    const [globalAfter] = await db
      .select()
      .from(guestGlobalDailyUsage)
      .where(eq(guestGlobalDailyUsage.usageDate, today))
    assert.equal((globalAfter?.usedTokens ?? 0) - globalSnapshot.usedTokens, cumulative)

    const capacity = await service.capacity(identity)
    assert.equal(capacity.perGuestDailyTokenUsed, cumulative)
    assert.equal(
      capacity.perGuestDailyTokenAvailable,
      config.guest!.perGuestDailyTokenLimit - cumulative,
    )
    assert.equal(capacity.activeThreads, 0)
  } finally {
    await db.delete(guest).where(eq(guest.id, guestId))
    await db.delete(user).where(eq(user.id, userId))
    if (globalRowExisted)
      await db
        .update(guestGlobalDailyUsage)
        .set(globalSnapshot)
        .where(eq(guestGlobalDailyUsage.usageDate, today))
    else await db.delete(guestGlobalDailyUsage).where(eq(guestGlobalDailyUsage.usageDate, today))
    await pool.end()
  }
})

async function insertRunningJob(
  db: Database,
  input: { guestId: string; guestThreadId: string; nativeTurnId: string; today: string },
) {
  await db.insert(guestTurnJob).values({
    id: randomUUID(),
    guestId: input.guestId,
    guestThreadId: input.guestThreadId,
    nativeTurnId: input.nativeTurnId,
    status: 'running',
    usageDate: input.today,
    inputText: 'integration',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low',
  })
}

function usageEvent(threadId: string, turnId: string, lastTokens: number, totalTokens: number) {
  return {
    method: 'thread/tokenUsage/updated',
    params: {
      threadId,
      turnId,
      tokenUsage: {
        modelContextWindow: 258_400,
        last: {
          inputTokens: 32_754,
          outputTokens: 440,
          reasoningOutputTokens: 80,
          totalTokens: lastTokens,
        },
        total: {
          inputTokens: 49_106,
          outputTokens: 469,
          reasoningOutputTokens: 93,
          totalTokens: totalTokens,
        },
      },
    },
  }
}

function completedEvent(threadId: string, turnId: string) {
  return {
    method: 'turn/completed',
    params: {
      threadId,
      turn: {
        id: turnId,
        status: 'completed',
        items: [],
        startedAt: 1_789_220_457,
        completedAt: 1_789_220_546,
        durationMs: 68_556,
      },
    },
  }
}
