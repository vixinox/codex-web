import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, isNull, sql } from 'drizzle-orm'

import type { GuestService } from '../guest-service.js'
import type { Database } from '../database.js'
import type { Auth } from '../auth.js'
import { apiError, requireSession } from './common.js'
import { guest, guestThread, guestTurnJob } from '../../src/lib/db/schema.js'

export async function registerAdminRoutes(
  app: FastifyInstance,
  {
    service,
    auth,
    db,
    profile,
  }: {
    service: GuestService
    auth: Auth
    db: Database
    profile: 'guest'
  },
) {
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await requireSession(request, reply, auth)
    if (!session) return null
    const user = session.user as { kind?: string }
    if (profile !== 'guest' || user.kind !== 'admin') {
      reply.status(403).send(apiError('ADMIN_ACCESS_REQUIRED', 'Admin access required'))
      return null
    }
    return session
  }

  app.get('/admin-api/overview', async (request, reply) => {
    const session = await requireAdmin(request, reply)
    if (!session) return

    const [activeLeaseRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(guest)
      .where(and(isNull(guest.deletedAt), sql`${guest.expiresAt} > now()`))

    const [failedTurnRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(guestTurnJob)
      .where(sql`${guestTurnJob.status} in ('failed', 'interrupted')`)

    const capacity = await service.globalCapacity()
    const rawRuntime = service.runtime()
    const sanitizedRuntime = {
      kind: rawRuntime.kind,
      status: rawRuntime.status,
      sandbox: rawRuntime.sandbox,
      network: rawRuntime.network,
      maxActiveThreads: rawRuntime.maxActiveThreads,
    }

    return {
      runtime: sanitizedRuntime,
      stats: {
        activeLeases: activeLeaseRow?.count ?? 0,
        activeThreads: capacity.activeThreads,
        queuedTurns: capacity.queuedTurns,
        failedTurns: failedTurnRow?.count ?? 0,
      },
      usage: {
        globalDailyTokenLimit: capacity.globalDailyTokenLimit,
        globalDailyTokenUsed: capacity.globalDailyTokenUsed,
        globalDailyTokenReserved: capacity.globalDailyTokenReserved,
        perGuestDailyTokenLimit: capacity.perGuestDailyTokenLimit,
        resetAt: capacity.resetAt,
      },
    }
  })

  app.get('/admin-api/leases', async (request, reply) => {
    const session = await requireAdmin(request, reply)
    if (!session) return

    const records = await db
      .select({
        id: guest.id,
        userId: guest.userId,
        createdAt: guest.createdAt,
        expiresAt: guest.expiresAt,
        deletedAt: guest.deletedAt,
      })
      .from(guest)
      .orderBy(sql`${guest.createdAt} desc`)
      .limit(50)

    const now = Date.now()
    const results = await Promise.all(
      records.map(async (record) => {
        const [threadCountRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(guestThread)
          .where(and(eq(guestThread.guestId, record.id), isNull(guestThread.deletedAt)))

        const status = record.deletedAt
          ? ('revoked' as const)
          : record.expiresAt.getTime() <= now
            ? ('expired' as const)
            : ('active' as const)

        return {
          id: record.id,
          userId: record.userId,
          createdAt: record.createdAt.toISOString(),
          expiresAt: record.expiresAt.toISOString(),
          status,
          threadCount: threadCountRow?.count ?? 0,
        }
      }),
    )

    return { leases: results }
  })

  app.post('/admin-api/leases/:leaseId/revoke', async (request, reply) => {
    const session = await requireAdmin(request, reply)
    if (!session) return

    const { leaseId } = request.params as { leaseId: string }
    const [record] = await db.select({ id: guest.id }).from(guest).where(eq(guest.id, leaseId))
    if (!record) {
      return reply.status(404).send(apiError('LEASE_NOT_FOUND', 'Guest lease not found'))
    }

    await service.revoke(leaseId)
    return { ok: true }
  })
}
