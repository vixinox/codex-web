import { randomToken } from '@codex-web/protocol/relay/crypto'

const LOGIN_QR_TTL_MS = 5 * 60 * 1_000

export type LoginQrCapability = {
  capability: string
  ownerId: string
  nodeId: string
  trustEpoch: number
  expiresAt: number
}

export class LoginQrCapabilityStore {
  private active?: LoginQrCapability
  private lastState: 'none' | 'consumed' | 'expired' | 'cancelled' | 'restarted' = 'none'
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  issue(ownerId: string, nodeId: string, trustEpoch: number): LoginQrCapability {
    const grant = {
      capability: randomToken(32),
      ownerId,
      nodeId,
      trustEpoch,
      expiresAt: this.now() + LOGIN_QR_TTL_MS,
    }
    this.active = grant
    this.lastState = 'none'
    return { ...grant }
  }

  cancel() {
    const hadActiveGrant = this.active !== undefined && this.active.expiresAt > this.now()
    if (hadActiveGrant) this.lastState = 'cancelled'
    else if (this.active && this.active.expiresAt <= this.now()) this.lastState = 'expired'
    this.active = undefined
    return hadActiveGrant
  }

  status() {
    const grant = this.active
    if (!grant || grant.expiresAt <= this.now()) {
      if (grant) this.lastState = 'expired'
      this.active = undefined
      return { state: this.lastState }
    }
    return { state: 'active' as const, expiresAt: new Date(grant.expiresAt).toISOString() }
  }

  consume(capability: string, nodeId: string, trustEpoch: number) {
    const grant = this.active
    if (!grant || grant.expiresAt <= this.now()) {
      if (grant) this.lastState = 'expired'
      this.active = undefined
      return null
    }
    if (
      grant.capability !== capability ||
      grant.nodeId !== nodeId ||
      grant.trustEpoch !== trustEpoch
    )
      return null

    this.active = undefined
    this.lastState = 'consumed'
    return { ownerId: grant.ownerId, nodeId: grant.nodeId, trustEpoch: grant.trustEpoch }
  }

  invalidate() {
    if (this.active) this.lastState = this.active.expiresAt > this.now() ? 'restarted' : 'expired'
    this.active = undefined
  }
}
