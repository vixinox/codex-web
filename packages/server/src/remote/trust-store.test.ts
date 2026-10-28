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
    const clientA = await serializeKeyPair(await generateKeyPair())
    const clientB = await serializeKeyPair(await generateKeyPair())
    const deviceA = await store.trustPeer(clientA.publicKey)
    const deviceB = await store.trustPeer(clientB.publicKey)

    const devices = await store.listPeers()
    assert.equal(devices.length, 2)
    assert.equal('publicKey' in (devices[0] ?? {}), false)
    const revokedId = deviceA
    const remainingId = deviceB
    const revokedKey = await store.revokePeer(revokedId)
    assert.ok(revokedKey)
    assert.equal(await store.isAuthorized(revokedKey), false)
    assert.deepEqual(await store.listPeers(), [devices[1]])
    assert.ok(remainingId)
  })
})

test('persists a nine-digit owner code and rotates it', async () => {
  await withDataRoot(async (dataRoot) => {
    const store = new RemoteTrustStore(dataRoot)
    const first = await store.ownerCode()
    assert.match(first, /^\d{9}$/)

    const reloaded = new RemoteTrustStore(dataRoot)
    assert.equal(await reloaded.ownerCode(), first)
    const second = await reloaded.rotateOwnerCode()
    assert.match(second, /^\d{9}$/)
    assert.notEqual(second, first)
    assert.equal(await new RemoteTrustStore(dataRoot).ownerCode(), second)
  })
})

test('reports whether trusting a client key created or reused a device', async () => {
  await withDataRoot(async (dataRoot) => {
    const store = new RemoteTrustStore(dataRoot)
    const clientKey = (await validKeyPair()).publicKey
    const created = await store.trustPeerWithStatus(clientKey)
    const reused = await store.trustPeerWithStatus(clientKey)

    assert.equal(created.created, true)
    assert.equal(reused.created, false)
    assert.equal(reused.deviceId, created.deviceId)
    assert.equal((await store.listPeers()).length, 1)
  })
})

test('rejects a corrupt trust file instead of repairing it', async () => {
  const keyPair = await validKeyPair()
  const clientKey = (await validKeyPair()).publicKey
  const base = () => ({
    nodeId: 'node-1',
    trustEpoch: 2,
    keyPair,
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

test('trust reset clears device records and rotates the E2EE trust epoch', async () => {
  await withDataRoot(async (dataRoot) => {
    const store = new RemoteTrustStore(dataRoot)
    const client = await validKeyPair()
    await store.trustPeer(client.publicKey)
    const before = await store.identity()
    const after = await store.reset()
    assert.equal(after.nodeId, before.nodeId)
    assert.equal(after.trustEpoch, before.trustEpoch + 1)
    assert.notEqual(after.ownerPublicKey, before.ownerPublicKey)
    assert.deepEqual(await store.listPeers(), [])
    assert.equal(await store.isAuthorized(client.publicKey), false)
  })
})
