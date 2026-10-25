import { randomToken } from '@codex-web/protocol/relay/crypto'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STORE_NAME = 'remote-bootstrap.json'
const LOCK_NAME = 'remote-bootstrap.lock'
const BOOTSTRAP_TTL_MS = 10 * 60 * 1_000
export const PROVISIONAL_SESSION_TTL_MS = 30 * 60 * 1_000
const LOCK_STALE_MS = 30_000

type BootstrapEntry = {
  bootstrapId: string
  nodeId: string
  trustEpoch: number
  expiresAt: number
  clientPublicKey: string | null
  sessionExpiresAt: number | null
}

type BootstrapState = { entries: BootstrapEntry[] }

export type BootstrapCapability = {
  bootstrapId: string
  expiresAt: number
}

export class RemoteBootstrapStore {
  private readonly dataRoot: string

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot
  }

  async issue(nodeId: string, trustEpoch: number): Promise<BootstrapCapability> {
    return this.withLock(async () => {
      const state = await this.readState()
      const now = Date.now()
      state.entries = state.entries.filter(
        (entry) => (entry.sessionExpiresAt ?? entry.expiresAt) > now,
      )
      const capability = { bootstrapId: randomToken(32), expiresAt: now + BOOTSTRAP_TTL_MS }
      state.entries.push({
        ...capability,
        nodeId,
        trustEpoch,
        clientPublicKey: null,
        sessionExpiresAt: null,
      })
      await this.writeState(state)
      return capability
    })
  }

  async authorizeAttach(
    bootstrapId: string,
    nodeId: string,
    trustEpoch: number,
    clientPublicKey: string,
  ): Promise<boolean> {
    const entry = (await this.readState()).entries.find(
      (candidate) => candidate.bootstrapId === bootstrapId,
    )
    if (!entry || entry.nodeId !== nodeId || entry.trustEpoch !== trustEpoch) return false
    if (entry.clientPublicKey === null) return entry.expiresAt > Date.now()
    return entry.clientPublicKey === clientPublicKey && (entry.sessionExpiresAt ?? 0) > Date.now()
  }

  async consume(token: string, secret: string, nodeId: string, trustEpoch: number) {
    const claims = verifyBootstrapToken(token, secret)
    if (
      !claims ||
      claims.nodeId !== nodeId ||
      claims.trustEpoch !== trustEpoch ||
      claims.role !== 'client' ||
      claims.admission !== 'bootstrap' ||
      typeof claims.bootstrapId !== 'string' ||
      typeof claims.expiresAt !== 'number' ||
      claims.expiresAt <= Date.now()
    )
      return null
    return this.withLock(async () => {
      const state = await this.readState()
      const entry = state.entries.find((candidate) => candidate.bootstrapId === claims.bootstrapId)
      if (
        !entry ||
        entry.nodeId !== nodeId ||
        entry.trustEpoch !== trustEpoch ||
        entry.expiresAt <= Date.now() ||
        claims.expiresAt !== entry.expiresAt
      )
        return null
      entry.expiresAt = Math.min(entry.expiresAt, Date.now() + 60_000)
      await this.writeState(state)
      return entry.bootstrapId
    })
  }

  async capability(bootstrapId: string) {
    const entry = (await this.readState()).entries.find(
      (candidate) => candidate.bootstrapId === bootstrapId,
    )
    if (!entry || (entry.sessionExpiresAt ?? entry.expiresAt) <= Date.now()) return null
    return { expiresAt: entry.sessionExpiresAt ?? entry.expiresAt }
  }

  async bindLogin(
    bootstrapId: string,
    nodeId: string,
    trustEpoch: number,
    clientPublicKey: string,
  ): Promise<number | null> {
    return this.withLock(async () => {
      const state = await this.readState()
      const entry = state.entries.find((candidate) => candidate.bootstrapId === bootstrapId)
      if (!entry || entry.nodeId !== nodeId || entry.trustEpoch !== trustEpoch) return null
      const now = Date.now()
      if (entry.clientPublicKey === null) {
        if (entry.expiresAt <= now) return null
        entry.clientPublicKey = clientPublicKey
        entry.sessionExpiresAt = now + PROVISIONAL_SESSION_TTL_MS
        await this.writeState(state)
        return entry.sessionExpiresAt
      }
      if (entry.clientPublicKey !== clientPublicKey || (entry.sessionExpiresAt ?? 0) <= now)
        return null
      return entry.sessionExpiresAt
    })
  }

  async sessionExpiry(
    bootstrapId: string,
    nodeId: string,
    trustEpoch: number,
    clientPublicKey: string,
  ): Promise<number | null> {
    const entry = (await this.readState()).entries.find(
      (candidate) => candidate.bootstrapId === bootstrapId,
    )
    if (
      !entry ||
      entry.nodeId !== nodeId ||
      entry.trustEpoch !== trustEpoch ||
      entry.clientPublicKey !== clientPublicKey ||
      (entry.sessionExpiresAt ?? 0) <= Date.now()
    )
      return null
    return entry.sessionExpiresAt
  }

  private async readState(): Promise<BootstrapState> {
    try {
      const raw = await readFile(this.path(), 'utf8')
      const value: unknown = JSON.parse(raw)
      if (!isRecord(value) || !Array.isArray(value.entries))
        throw new Error('Invalid bootstrap store')
      return { entries: value.entries.map(parseEntry) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] }
      throw error
    }
  }

  private async writeState(state: BootstrapState) {
    await mkdir(this.dataRoot, { recursive: true })
    const temporaryPath = `${this.path()}.${randomToken(8)}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryPath, this.path())
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.dataRoot, { recursive: true })
    const lockPath = join(this.dataRoot, LOCK_NAME)
    const deadline = Date.now() + 5_000
    let lock: Awaited<ReturnType<typeof open>> | undefined
    while (!lock) {
      try {
        lock = await open(lockPath, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          if (Date.now() - (await stat(lockPath)).mtimeMs > LOCK_STALE_MS) await unlink(lockPath)
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError
        }
        if (Date.now() >= deadline) throw new Error('Bootstrap store is busy')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    try {
      return await operation()
    } finally {
      await lock.close()
      await unlink(lockPath).catch(() => undefined)
    }
  }

  private path() {
    return join(this.dataRoot, STORE_NAME)
  }
}

function verifyBootstrapToken(token: string, secret: string): Record<string, unknown> | null {
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return null
  const expected = createHmac('sha256', secret).update(encoded).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function parseEntry(value: unknown): BootstrapEntry {
  if (
    !isRecord(value) ||
    typeof value.bootstrapId !== 'string' ||
    typeof value.nodeId !== 'string' ||
    !Number.isSafeInteger(value.trustEpoch) ||
    typeof value.expiresAt !== 'number' ||
    !(value.clientPublicKey === null || typeof value.clientPublicKey === 'string') ||
    !(value.sessionExpiresAt === null || typeof value.sessionExpiresAt === 'number')
  )
    throw new Error('Invalid bootstrap store entry')
  return {
    bootstrapId: value.bootstrapId,
    nodeId: value.nodeId,
    trustEpoch: value.trustEpoch as number,
    expiresAt: value.expiresAt,
    clientPublicKey: value.clientPublicKey,
    sessionExpiresAt: value.sessionExpiresAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
