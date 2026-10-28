import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomInt } from 'node:crypto'
import { join } from 'node:path'
import {
  randomToken,
  generateKeyPair,
  serializeKeyPair,
  type SerializedKeyPair,
} from '@codex-web/protocol/relay/crypto'
import { importPublicKey } from '@codex-web/protocol/relay/crypto'

const STORE_NAME = 'remote-trust.json'
const TRUST_CHALLENGE_TTL_MS = 60_000

type RemotePeer = {
  id: string
  publicKey: string
  createdAt: string
  lastSeenAt: string | null
}

type TrustState = {
  nodeId: string
  ownerCode: string
  trustEpoch: number
  keyPair: SerializedKeyPair
  peers: RemotePeer[]
}

export class RemoteTrustStore {
  private state?: TrustState
  private writeChain = Promise.resolve()
  private readonly dataRoot: string
  private readonly trustChallenges = new Map<string, { publicKey: string; expiresAt: number }>()

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot
  }

  async load() {
    if (this.state) return this.state
    try {
      const raw = await readFile(this.path(), 'utf8')
      const { state, legacyPeerIds, legacyOwnerCode } = parseState(raw)
      this.state = state
      if (legacyPeerIds || legacyOwnerCode) await this.persist()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const keyPair = await serializeKeyPair(await generateKeyPair())
      this.state = {
        nodeId: randomToken(18),
        ownerCode: createOwnerCode(),
        trustEpoch: 0,
        keyPair,
        peers: [],
      }
      await this.persist()
    }
    return this.state
  }

  async trustPeer(clientPublicKey: string) {
    return (await this.trustPeerWithStatus(clientPublicKey)).deviceId
  }

  async trustPeerWithStatus(clientPublicKey: string) {
    const state = await this.load()
    await importPublicKey(clientPublicKey)
    const existing = state.peers.find((peer) => peer.publicKey === clientPublicKey)
    if (existing) return { deviceId: existing.id, created: false }
    const deviceId = randomToken(12)
    state.peers.push({
      id: deviceId,
      publicKey: clientPublicKey,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    })
    await this.persist()
    return { deviceId, created: true }
  }

  issueTrustChallenge(_sessionId: string, publicKey: string) {
    const challenge = randomToken(24)
    this.trustChallenges.set(challenge, {
      publicKey,
      expiresAt: Date.now() + TRUST_CHALLENGE_TTL_MS,
    })
    return { challenge, expiresAt: new Date(Date.now() + TRUST_CHALLENGE_TTL_MS).toISOString() }
  }

  consumeTrustChallenge(challenge: string, _sessionId: string, publicKey: string) {
    const entry = this.trustChallenges.get(challenge)
    this.trustChallenges.delete(challenge)
    return Boolean(entry && entry.publicKey === publicKey && entry.expiresAt > Date.now())
  }

  async isAuthorized(clientPublicKey: string) {
    const state = await this.load()
    return state.peers.some((peer) => peer.publicKey === clientPublicKey)
  }

  async listPeers() {
    const state = await this.load()
    return state.peers.map(({ id, createdAt, lastSeenAt }) => ({ id, createdAt, lastSeenAt }))
  }

  async revokePeer(id: string) {
    const state = await this.load()
    const peer = state.peers.find((candidate) => candidate.id === id)
    if (!peer) return null
    state.peers = state.peers.filter((candidate) => candidate.id !== id)
    await this.persist()
    return peer.publicKey
  }

  async deviceId(clientPublicKey: string) {
    const state = await this.load()
    return state.peers.find((peer) => peer.publicKey === clientPublicKey)?.id
  }

  async markSeen(clientPublicKey: string) {
    const state = await this.load()
    const peer = state.peers.find((candidate) => candidate.publicKey === clientPublicKey)
    if (!peer) return false
    peer.lastSeenAt = new Date().toISOString()
    await this.persist()
    return true
  }

  async reset() {
    const state = await this.load()
    state.trustEpoch += 1
    state.keyPair = await serializeKeyPair(await generateKeyPair())
    state.peers = []
    await this.persist()
    return {
      nodeId: state.nodeId,
      trustEpoch: state.trustEpoch,
      ownerPublicKey: state.keyPair.publicKey,
    }
  }

  async identity() {
    const state = await this.load()
    return {
      nodeId: state.nodeId,
      ownerCode: state.ownerCode,
      trustEpoch: state.trustEpoch,
      ownerPublicKey: state.keyPair.publicKey,
      privateKey: state.keyPair.privateKey,
    }
  }

  async ownerCode() {
    return (await this.load()).ownerCode
  }

  async rotateOwnerCode() {
    const state = await this.load()
    state.ownerCode = createOwnerCode()
    await this.persist()
    return state.ownerCode
  }

  async setOwnerCode(ownerCode: string) {
    if (!isOwnerCode(ownerCode)) throw new Error('INVALID_OWNER_CODE')
    const state = await this.load()
    state.ownerCode = ownerCode
    await this.persist()
  }

  async status() {
    const state = await this.load()
    return {
      nodeId: state.nodeId,
      trustEpoch: state.trustEpoch,
      ownerPublicKey: state.keyPair.publicKey,
      pairedClients: state.peers.length,
    }
  }

  private path() {
    return join(this.dataRoot, STORE_NAME)
  }

  private async persist() {
    const state = this.state
    if (!state) throw new Error('Remote trust state is not loaded')
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(this.dataRoot, { recursive: true })
      const temporaryPath = `${this.path()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporaryPath, this.path())
      return undefined
    })
    await this.writeChain
  }
}

/**
 * Parses the trust file strictly. A partially valid file is treated as corruption rather than
 * silently repaired, because a dropped peer entry or reset epoch would change who is authorized.
 * The only tolerated legacy shape is a peer written before device ids existed.
 */
function parseState(raw: string): {
  state: TrustState
  legacyPeerIds: boolean
  legacyOwnerCode: boolean
} {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value)) throw new Error('Invalid remote trust state')
  const { nodeId, ownerCode, trustEpoch, keyPair, peers } = value
  if (
    typeof nodeId !== 'string' ||
    nodeId.length === 0 ||
    (ownerCode !== undefined && !isOwnerCode(ownerCode)) ||
    !Number.isSafeInteger(trustEpoch) ||
    !isRecord(keyPair) ||
    typeof keyPair.publicKey !== 'string' ||
    typeof keyPair.privateKey !== 'string' ||
    !Array.isArray(peers)
  )
    throw new Error('Invalid remote trust state')

  const seenKeys = new Set<string>()
  const seenIds = new Set<string>()
  let legacyPeerIds = false
  const parsedPeers: RemotePeer[] = peers.map((peer) => {
    if (
      !isRecord(peer) ||
      typeof peer.publicKey !== 'string' ||
      peer.publicKey.length === 0 ||
      typeof peer.createdAt !== 'string' ||
      !(peer.lastSeenAt === null || typeof peer.lastSeenAt === 'string')
    )
      throw new Error('Invalid remote trust peer')
    if (seenKeys.has(peer.publicKey)) throw new Error('Duplicate remote trust peer')
    seenKeys.add(peer.publicKey)
    let id: string
    if (typeof peer.id === 'string' && peer.id.length > 0) {
      id = peer.id
    } else if (peer.id === undefined) {
      legacyPeerIds = true
      id = randomToken(12)
    } else {
      throw new Error('Invalid remote trust peer id')
    }
    if (seenIds.has(id)) throw new Error('Duplicate remote trust peer id')
    seenIds.add(id)
    return {
      id,
      publicKey: peer.publicKey,
      createdAt: peer.createdAt,
      lastSeenAt: peer.lastSeenAt as string | null,
    }
  })

  return {
    state: {
      nodeId,
      ownerCode: isOwnerCode(ownerCode) ? ownerCode : createOwnerCode(),
      trustEpoch: trustEpoch as number,
      keyPair: { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey },
      peers: parsedPeers,
    },
    legacyPeerIds,
    legacyOwnerCode: ownerCode === undefined,
  }
}

function createOwnerCode() {
  return randomInt(0, 1_000_000_000).toString().padStart(9, '0')
}

function isOwnerCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{9}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
