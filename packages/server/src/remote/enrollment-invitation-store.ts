import { createHash, randomBytes } from 'node:crypto'

export type EnrollmentInvitationBinding = {
  ownerId: string
  nodeId: string
  trustEpoch: number
  issuer: 'owner-local' | 'cli' | 'paired-device'
  issuerDeviceId?: string
}

type EnrollmentIdentityBinding = Pick<
  EnrollmentInvitationBinding,
  'ownerId' | 'nodeId' | 'trustEpoch'
>

type InvitationEntry = EnrollmentInvitationBinding & {
  referenceHash: string
  expiresAt: number
  consumed: boolean
  clientPublicKey?: string
}

export class EnrollmentInvitationStore {
  private entry: InvitationEntry | undefined
  private readonly now: () => number

  constructor(now = () => Date.now()) {
    this.now = now
  }

  issue(binding: EnrollmentInvitationBinding) {
    const reference = randomBytes(18).toString('base64url')
    const expiresAt = this.now() + 5 * 60_000
    this.entry = {
      ...binding,
      referenceHash: hash(reference),
      expiresAt,
      consumed: false,
    }
    return { reference, expiresAt }
  }

  status() {
    const entry = this.entry
    if (!entry || entry.expiresAt <= this.now()) {
      this.entry = undefined
      return null
    }
    return {
      expiresAt: entry.expiresAt,
      consumed: entry.consumed,
      issuer: entry.issuer,
      ...(entry.issuerDeviceId ? { issuerDeviceId: entry.issuerDeviceId } : {}),
    }
  }

  consume(reference: string, binding: EnrollmentIdentityBinding & { clientPublicKey: string }) {
    const entry = this.entry
    if (!entry || entry.consumed || entry.expiresAt <= this.now()) return false
    if (
      !equal(entry.referenceHash, hash(reference)) ||
      entry.ownerId !== binding.ownerId ||
      entry.nodeId !== binding.nodeId ||
      entry.trustEpoch !== binding.trustEpoch ||
      (entry.clientPublicKey !== undefined && entry.clientPublicKey !== binding.clientPublicKey)
    )
      return false
    entry.consumed = true
    entry.clientPublicKey = binding.clientPublicKey
    return true
  }

  invalidate() {
    this.entry = undefined
  }

  cancel() {
    const existed = this.status() !== null
    this.entry = undefined
    return existed
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

function equal(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && Buffer.compare(leftBytes, rightBytes) === 0
}
