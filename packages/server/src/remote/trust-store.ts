import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  randomToken,
  generateKeyPair,
  serializeKeyPair,
  type SerializedKeyPair,
} from '@codex-web/protocol/relay/crypto'

import { importPublicKey } from '@codex-web/protocol/relay/crypto'

const STORE_NAME = 'remote-trust.json'
const OFFER_TTL_MS = 5 * 60 * 1_000

type PendingOffer = {
  challenge: string
  expiresAt: string
  used: boolean
}

type RemotePeer = {
  publicKey: string
  createdAt: string
  lastSeenAt: string | null
}

type TrustState = {
  nodeId: string
  trustEpoch: number
  keyPair: SerializedKeyPair
  pendingOffers: PendingOffer[]
  peers: RemotePeer[]
}

export type PairingOffer = {
  nodeId: string
  ownerPublicKey: string
  challenge: string
  expiresAt: string
  trustEpoch: number
}

export class RemoteTrustStore {
  private state?: TrustState
  private writeChain = Promise.resolve()
  private readonly dataRoot: string

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot
  }

  async load() {
    if (this.state) return this.state
    try {
      const raw = await readFile(this.path(), 'utf8')
      this.state = parseState(raw)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const keyPair = await serializeKeyPair(await generateKeyPair())
      this.state = {
        nodeId: randomToken(18),
        trustEpoch: 0,
        keyPair,
        pendingOffers: [],
        peers: [],
      }
      await this.persist()
    }
    return this.state
  }

  async createPairingOffer(relayUrl: string): Promise<PairingOffer & { relayUrl: string }> {
    const state = await this.load()
    const now = Date.now()
    state.pendingOffers = state.pendingOffers.filter(
      (offer) => !offer.used && Date.parse(offer.expiresAt) > now,
    )
    const expiresAt = new Date(now + OFFER_TTL_MS).toISOString()
    const offer: PendingOffer = { challenge: randomToken(24), expiresAt, used: false }
    state.pendingOffers.push(offer)
    await this.persist()
    return {
      relayUrl,
      nodeId: state.nodeId,
      ownerPublicKey: state.keyPair.publicKey,
      challenge: offer.challenge,
      expiresAt,
      trustEpoch: state.trustEpoch,
    }
  }

  async acceptPairing(challenge: string, clientPublicKey: string) {
    const state = await this.load()
    await importPublicKey(clientPublicKey)
    const offer = state.pendingOffers.find(
      (candidate) =>
        candidate.challenge === challenge &&
        !candidate.used &&
        Date.parse(candidate.expiresAt) > Date.now(),
    )
    if (!offer) return false
    offer.used = true
    state.peers = state.peers.filter((peer) => peer.publicKey !== clientPublicKey)
    state.peers.push({
      publicKey: clientPublicKey,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    })
    await this.persist()
    return true
  }

  async isAuthorized(clientPublicKey: string) {
    const state = await this.load()
    return state.peers.some((peer) => peer.publicKey === clientPublicKey)
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
    state.pendingOffers = []
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
      trustEpoch: state.trustEpoch,
      ownerPublicKey: state.keyPair.publicKey,
      privateKey: state.keyPair.privateKey,
    }
  }

  async status() {
    const state = await this.load()
    return {
      nodeId: state.nodeId,
      trustEpoch: state.trustEpoch,
      ownerPublicKey: state.keyPair.publicKey,
      pairedClients: state.peers.length,
      pendingOffers: state.pendingOffers.filter(
        (offer) => !offer.used && Date.parse(offer.expiresAt) > Date.now(),
      ).length,
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

function parseState(raw: string): TrustState {
  const parsed = JSON.parse(raw) as Partial<TrustState>
  if (
    typeof parsed.nodeId !== 'string' ||
    !Number.isSafeInteger(parsed.trustEpoch) ||
    !parsed.keyPair ||
    typeof parsed.keyPair.publicKey !== 'string' ||
    typeof parsed.keyPair.privateKey !== 'string' ||
    !Array.isArray(parsed.pendingOffers) ||
    !Array.isArray(parsed.peers)
  )
    throw new Error('Invalid remote trust state')
  return parsed as TrustState
}
