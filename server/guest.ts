import { randomBytes } from 'node:crypto'
import type { GuestRuntimeContract } from '../src/lib/bridge/guest-contract.js'

const DEFAULT_LEASE_TTL_MS = 1000 * 60 * 60 * 24

export type GuestLease = {
  id: string
  expiresAt: Date
}

/**
 * Anonymous Guest identity is deliberately separate from Better Auth users.
 * It is only a short-lived capability for the guest API surface; it must never
 * be accepted by the owner `/api/*` routes.
 */
export class GuestLeaseStore {
  private readonly leases = new Map<string, GuestLease>()

  create(now = Date.now()) {
    this.prune(now)
    const id = randomBytes(32).toString('base64url')
    const lease = { id, expiresAt: new Date(now + DEFAULT_LEASE_TTL_MS) }
    this.leases.set(id, lease)
    return lease
  }

  read(id: string | undefined, now = Date.now()) {
    this.prune(now)
    return id ? (this.leases.get(id) ?? null) : null
  }

  reset(id: string | undefined, now = Date.now()) {
    if (id) this.leases.delete(id)
    return this.create(now)
  }

  private prune(now: number) {
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt.getTime() <= now) this.leases.delete(id)
    }
  }
}

/**
 * Test-only fallback contract used when route unit tests deliberately build
 * without PostgreSQL or the real Guest runtime. Production always injects the
 * database-backed Guest service.
 */
export type GuestRuntime = GuestRuntimeContract

export const guestRuntimeSkeleton: GuestRuntime = {
  kind: 'guest-runtime',
  maxActiveThreads: 5,
  modelContextWindow: 256_000,
  sandbox: 'workspaceWrite',
  network: 'disabled',
  status: 'not-configured',
}
