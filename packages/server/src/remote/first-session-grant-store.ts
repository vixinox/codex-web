import { createHash, randomBytes } from 'node:crypto'

export type FirstSessionGrantBinding = {
  ownerId: string
  nodeId: string
  trustEpoch: number
  remoteOrigin: string
}

type GrantEntry = FirstSessionGrantBinding & {
  grantHash: string
  referenceHash: string
  expiresAt: number
  consumed: boolean
  clientPublicKey?: string
}

export class FirstSessionGrantStore {
  private entry: GrantEntry | undefined
  private readonly now: () => number

  constructor(now = () => Date.now()) {
    this.now = now
  }

  issue(binding: FirstSessionGrantBinding) {
    const grant = randomBytes(32).toString('base64url')
    const reference = randomBytes(18).toString('base64url')
    const expiresAt = this.now() + 5 * 60_000
    this.entry = {
      ...binding,
      grantHash: hash(grant),
      referenceHash: hash(reference),
      expiresAt,
      consumed: false,
    }
    return { grant, reference, expiresAt }
  }

  consume(
    grantOrReference: string,
    binding: FirstSessionGrantBinding & { clientPublicKey: string },
  ) {
    const entry = this.entry
    if (!entry || entry.consumed || entry.expiresAt <= this.now()) return false
    if (
      (!equal(entry.grantHash, hash(grantOrReference)) &&
        !equal(entry.referenceHash, hash(grantOrReference))) ||
      entry.ownerId !== binding.ownerId ||
      entry.nodeId !== binding.nodeId ||
      entry.trustEpoch !== binding.trustEpoch ||
      entry.remoteOrigin !== binding.remoteOrigin ||
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
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

function equal(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && Buffer.compare(leftBytes, rightBytes) === 0
}
