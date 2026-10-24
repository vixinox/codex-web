import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { generateKeyPair, serializeKeyPair } from '@codex-web/protocol/relay/crypto'

import { RemoteTrustStore } from './trust-store.js'

async function withDataRoot(run: (dataRoot: string) => Promise<void>) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'codex-web-trust-'))
  try {
    await run(dataRoot)
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }
}

async function validKeyPair() {
  return serializeKeyPair(await generateKeyPair())
}

async function writeTrustFile(dataRoot: string, value: unknown) {
  await mkdir(dataRoot, { recursive: true })
  await writeFile(
    join(dataRoot, 'remote-trust.json'),
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

async function readTrustFile(dataRoot: string) {
  return JSON.parse(await readFile(join(dataRoot, 'remote-trust.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

test('lists paired devices and revokes one device without disturbing another', async () => {
  await withDataRoot(async (dataRoot) => {
    const store = new RemoteTrustStore(dataRoot)
    const offerA = await store.createPairingOffer('wss://relay.example.test/ws')
    const offerB = await store.createPairingOffer('wss://relay.example.test/ws')
    const clientA = await serializeKeyPair(await generateKeyPair())
    const clientB = await serializeKeyPair(await generateKeyPair())
    assert.ok(await store.acceptPairing(offerA.challenge, clientA.publicKey))
    assert.ok(await store.acceptPairing(offerB.challenge, clientB.publicKey))

    const devices = await store.listPeers()
    assert.equal(devices.length, 2)
    assert.equal('publicKey' in (devices[0] ?? {}), false)
    const revokedId = devices[0]!.id
    const remainingId = devices[1]!.id
    const revokedKey = await store.revokePeer(revokedId)
    assert.ok(revokedKey)
    assert.equal(await store.isAuthorized(revokedKey), false)
    assert.deepEqual(await store.listPeers(), [devices[1]])
    assert.ok(remainingId)
  })
})

test('rejects a corrupt trust file instead of repairing it', async () => {
  const keyPair = await validKeyPair()
  const clientKey = (await validKeyPair()).publicKey
  const base = () => ({
    nodeId: 'node-1',
    trustEpoch: 2,
    keyPair,
    pendingOffers: [
      {
        challenge: 'challenge-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        used: false,
      },
    ],
    peers: [
      { id: 'peer-1', publicKey: clientKey, createdAt: new Date().toISOString(), lastSeenAt: null },
    ],
  })

  const cases: Array<{ name: string; mutate: (state: Record<string, unknown>) => void }> = [
    {
      name: 'missing nodeId',
      mutate: (state) => {
        delete state.nodeId
      },
    },
    {
      name: 'non-integer trustEpoch',
      mutate: (state) => {
        state.trustEpoch = 1.5
      },
    },
    {
      name: 'peer entry missing publicKey',
      mutate: (state) => {
        state.peers = [{ id: 'peer-1', createdAt: new Date().toISOString(), lastSeenAt: null }]
      },
    },
    {
      name: 'pending offer with unparseable expiresAt',
      mutate: (state) => {
        state.pendingOffers = [{ challenge: 'challenge-1', expiresAt: 'not-a-date', used: false }]
      },
    },
    {
      name: 'two peers sharing one publicKey',
      mutate: (state) => {
        state.peers = [
          {
            id: 'peer-1',
            publicKey: clientKey,
            createdAt: new Date().toISOString(),
            lastSeenAt: null,
          },
          {
            id: 'peer-2',
            publicKey: clientKey,
            createdAt: new Date().toISOString(),
            lastSeenAt: null,
          },
        ]
      },
    },
  ]

  for (const { name, mutate } of cases) {
    await withDataRoot(async (dataRoot) => {
      const state = base()
      mutate(state)
      const before = `${JSON.stringify(state, null, 2)}\n`
      await writeTrustFile(dataRoot, before)

      const store = new RemoteTrustStore(dataRoot)
      await assert.rejects(() => store.load(), name)

      // A corrupt file must be left untouched: no rewrite, no fresh identity minted.
      assert.equal(await readFile(join(dataRoot, 'remote-trust.json'), 'utf8'), before, name)
    })
  }
})

test('accepts a legacy peer without id and persists the assigned id', async () => {
  await withDataRoot(async (dataRoot) => {
    const keyPair = await validKeyPair()
    const clientKey = (await validKeyPair()).publicKey
    await writeTrustFile(dataRoot, {
      nodeId: 'node-legacy',
      trustEpoch: 3,
      keyPair,
      pendingOffers: [],
      peers: [{ publicKey: clientKey, createdAt: new Date().toISOString(), lastSeenAt: null }],
    })

    const store = new RemoteTrustStore(dataRoot)
    assert.equal(await store.isAuthorized(clientKey), true)

    const persisted = await readTrustFile(dataRoot)
    const peers = persisted.peers as Array<Record<string, unknown>>
    assert.equal(peers.length, 1)
    const assignedId = peers[0]!.id
    assert.equal(typeof assignedId, 'string')
    assert.ok(typeof assignedId === 'string' && assignedId.length > 0)
    assert.equal(persisted.nodeId, 'node-legacy')
    assert.equal(persisted.trustEpoch, 3)

    // The rewritten file is a strict, current-shape file: a fresh store keeps the same id.
    const reloaded = new RemoteTrustStore(dataRoot)
    assert.deepEqual(await reloaded.listPeers(), await store.listPeers())
    assert.equal(await reloaded.deviceId(clientKey), assignedId)
  })
})

test('acceptPairing refuses a second device record for an already trusted key', async () => {
  await withDataRoot(async (dataRoot) => {
    const store = new RemoteTrustStore(dataRoot)
    const pkcs = await validKeyPair()
    const first = await store.createPairingOffer('wss://relay.example.test/ws')
    const firstId = await store.acceptPairing(first.challenge, pkcs.publicKey)
    assert.ok(firstId)

    const second = await store.createPairingOffer('wss://relay.example.test/ws')
    assert.equal(await store.acceptPairing(second.challenge, pkcs.publicKey), null)

    const devices = await store.listPeers()
    assert.equal(devices.length, 1)
    assert.equal(devices[0]!.id, firstId)
    assert.equal(await store.deviceId(pkcs.publicKey), firstId)

    const persisted = await readTrustFile(dataRoot)
    assert.equal((persisted.peers as unknown[]).length, 1)

    // The reused offer was still consumed, so it cannot be retried against another key.
    const other = await validKeyPair()
    assert.equal(await store.acceptPairing(second.challenge, other.publicKey), null)
    assert.equal(await store.isAuthorized(other.publicKey), false)
  })
})

test('acceptPairing refuses an expired offer and a reused challenge', async () => {
  await withDataRoot(async (dataRoot) => {
    const keyPair = await validKeyPair()
    await writeTrustFile(dataRoot, {
      nodeId: 'node-offers',
      trustEpoch: 1,
      keyPair,
      pendingOffers: [
        {
          challenge: 'expired-challenge',
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          used: false,
        },
        {
          challenge: 'used-challenge',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          used: true,
        },
      ],
      peers: [],
    })

    const store = new RemoteTrustStore(dataRoot)
    const client = await validKeyPair()
    assert.equal(await store.acceptPairing('expired-challenge', client.publicKey), null)
    assert.equal(await store.acceptPairing('used-challenge', client.publicKey), null)
    assert.equal(await store.acceptPairing('missing-challenge', client.publicKey), null)

    assert.deepEqual(await store.listPeers(), [])
    assert.equal(await store.isAuthorized(client.publicKey), false)

    // A freshly minted offer still works, so the rejections came from expiry/use, not breakage.
    const offer = await store.createPairingOffer('wss://relay.example.test/ws')
    assert.equal((await store.acceptPairing(offer.challenge, client.publicKey)) !== null, true)
    assert.equal(await store.isAuthorized(client.publicKey), true)
  })
})
