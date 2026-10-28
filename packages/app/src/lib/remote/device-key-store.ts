import { generatePersistentDeviceKeyPair, serializePublicKey } from './relay-crypto'

export type DeviceKeyRecord = {
  deviceId: string | null
  publicKey: string
  privateKey: CryptoKey
  pairedClientToken: string | null
  trustEpoch: number | null
  nodeId: string | null
  relayUrl: string | null
  ownerCode: string | null
  ownerId: string | null
  sessionKey: CryptoKey | null
  encryptedSession: EncryptedRemoteSession | null
}

export type EncryptedRemoteSession = {
  iv: string
  ciphertext: string
  relayUrl: string
  ownerCode: string
  nodeId: string
  deviceId: string
  ownerId: string
  expiresAt: string
}

type KeyDatabase = IDBDatabase
const DB_NAME = 'codex-web-remote'
const STORE_NAME = 'device-key'

function openDatabase(): Promise<KeyDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open device key store'))
  })
}

export async function createDeviceKey() {
  const pair = await generatePersistentDeviceKeyPair()
  const publicKey = await serializePublicKey(pair.publicKey)
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(
      {
        deviceId: null,
        publicKey,
        privateKey: pair.privateKey,
        pairedClientToken: null,
        trustEpoch: null,
        nodeId: null,
        relayUrl: null,
        ownerCode: null,
        ownerId: null,
        sessionKey: null,
        encryptedSession: null,
      },
      'current',
    )
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Unable to persist device key'))
  })
  db.close()
  return { publicKey }
}

export async function loadDeviceKey(): Promise<DeviceKeyRecord | null> {
  try {
    const db = await openDatabase()
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get('current')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    if (value === undefined) return null
    if (!isDeviceKeyRecord(value)) {
      await deleteStoredKey()
      return null
    }
    return {
      ...value,
      pairedClientToken: (value as Partial<DeviceKeyRecord>).pairedClientToken ?? null,
      trustEpoch: (value as Partial<DeviceKeyRecord>).trustEpoch ?? null,
      nodeId: (value as Partial<DeviceKeyRecord>).nodeId ?? null,
      relayUrl: (value as Partial<DeviceKeyRecord>).relayUrl ?? null,
      ownerCode: (value as Partial<DeviceKeyRecord>).ownerCode ?? null,
      ownerId: (value as Partial<DeviceKeyRecord>).ownerId ?? null,
      sessionKey: (value as Partial<DeviceKeyRecord>).sessionKey ?? null,
      encryptedSession: (value as Partial<DeviceKeyRecord>).encryptedSession ?? null,
    }
  } catch {
    await deleteStoredKey().catch(() => undefined)
    return null
  }
}

export async function setDeviceId(deviceId: string) {
  const record = await loadDeviceKey()
  if (!record) throw new Error('Device key is missing')
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ ...record, deviceId }, 'current')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function setPairedDevice(input: {
  deviceId: string
  pairedClientToken: string
  trustEpoch: number
  nodeId?: string
  relayUrl?: string
}) {
  const record = await loadDeviceKey()
  if (!record) throw new Error('Device key is missing')
  await putDeviceKey({ ...record, ...input })
}

export async function saveRemoteOwnerSession(input: {
  token: string
  expiresAt: string
  relayUrl: string
  ownerCode: string
  nodeId: string
  deviceId: string
  ownerId: string
}) {
  const record = await loadDeviceKey()
  if (!record || record.deviceId !== input.deviceId || !record.pairedClientToken)
    throw new Error('Paired device is missing')
  const key =
    record.sessionKey ??
    (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]))
  const metadata = {
    relayUrl: input.relayUrl,
    ownerCode: input.ownerCode,
    nodeId: input.nodeId,
    deviceId: input.deviceId,
    ownerId: input.ownerId,
    expiresAt: input.expiresAt,
  }
  const encryptedSession = await encryptRemoteSession(key, input.token, metadata)
  await putDeviceKey({ ...record, sessionKey: key, encryptedSession, ...metadata })
}

export async function loadRemoteOwnerSession(input: {
  relayUrl: string
  ownerCode: string
  nodeId: string
  deviceId: string
  ownerId?: string
}): Promise<{ token: string; expiresAt: string; ownerId: string } | null> {
  const record = await loadDeviceKey()
  const encrypted = record?.encryptedSession
  if (!record?.sessionKey || !encrypted) return null
  if (
    encrypted.relayUrl !== input.relayUrl ||
    encrypted.ownerCode !== input.ownerCode ||
    encrypted.nodeId !== input.nodeId ||
    encrypted.deviceId !== input.deviceId ||
    (input.ownerId !== undefined && encrypted.ownerId !== input.ownerId) ||
    typeof encrypted.ownerId !== 'string' ||
    Date.parse(encrypted.expiresAt) <= Date.now()
  ) {
    await clearRemoteOwnerSession()
    return null
  }
  try {
    const token = await decryptRemoteSession(record.sessionKey, encrypted)
    return { token, expiresAt: encrypted.expiresAt, ownerId: encrypted.ownerId }
  } catch {
    await clearRemoteOwnerSession()
    return null
  }
}

export async function clearRemoteOwnerSession() {
  const record = await loadDeviceKey()
  if (!record || (!record.sessionKey && !record.encryptedSession)) return
  await putDeviceKey({ ...record, sessionKey: null, encryptedSession: null })
}

export async function encryptRemoteSession(
  key: CryptoKey,
  token: string,
  metadata: Omit<EncryptedRemoteSession, 'iv' | 'ciphertext'>,
): Promise<EncryptedRemoteSession> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const additionalData = new TextEncoder().encode(JSON.stringify(metadata))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    new TextEncoder().encode(token),
  )
  return {
    ...metadata,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptRemoteSession(
  key: CryptoKey,
  encrypted: EncryptedRemoteSession,
): Promise<string> {
  const { iv, ciphertext, ...metadata } = encrypted
  const cleartext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(iv),
      additionalData: new TextEncoder().encode(JSON.stringify(metadata)),
    },
    key,
    fromBase64Url(ciphertext),
  )
  return new TextDecoder().decode(cleartext)
}

export async function setRemoteTarget(input: {
  nodeId: string
  relayUrl: string
  ownerCode?: string
  ownerId?: string
}) {
  const record = await loadDeviceKey()
  if (!record) throw new Error('Device key is missing')
  await putDeviceKey({ ...record, ...input })
}

export async function clearPairedDevice() {
  const record = await loadDeviceKey()
  if (!record) return
  await putDeviceKey({
    ...record,
    deviceId: null,
    pairedClientToken: null,
    trustEpoch: null,
    sessionKey: null,
    encryptedSession: null,
  })
}

export async function clearDeviceKey() {
  await deleteStoredKey()
}

export async function restoreDeviceKey(record: DeviceKeyRecord | null) {
  if (!record) {
    await deleteStoredKey()
    return
  }
  await putDeviceKey(record)
}

async function deleteStoredKey() {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete('current')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function putDeviceKey(record: DeviceKeyRecord) {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record, 'current')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Unable to persist device key'))
  })
  db.close()
}

function isDeviceKeyRecord(value: unknown): value is DeviceKeyRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<DeviceKeyRecord>
  return (
    (record.deviceId === null || typeof record.deviceId === 'string') &&
    typeof record.publicKey === 'string' &&
    record.publicKey.length > 0 &&
    !!record.privateKey &&
    typeof record.privateKey === 'object' &&
    (record.privateKey as CryptoKey).extractable === false &&
    (record.pairedClientToken === undefined ||
      record.pairedClientToken === null ||
      typeof record.pairedClientToken === 'string') &&
    (record.trustEpoch === undefined ||
      record.trustEpoch === null ||
      (Number.isSafeInteger(record.trustEpoch) && (record.trustEpoch as number) >= 0)) &&
    (record.nodeId === undefined || record.nodeId === null || typeof record.nodeId === 'string') &&
    (record.relayUrl === undefined ||
      record.relayUrl === null ||
      typeof record.relayUrl === 'string') &&
    (record.ownerCode === undefined ||
      record.ownerCode === null ||
      typeof record.ownerCode === 'string') &&
    (record.ownerId === undefined ||
      record.ownerId === null ||
      typeof record.ownerId === 'string') &&
    (record.sessionKey === undefined ||
      record.sessionKey === null ||
      isAesSessionKey(record.sessionKey)) &&
    (record.encryptedSession === undefined ||
      record.encryptedSession === null ||
      isEncryptedRemoteSession(record.encryptedSession))
  )
}

function isAesSessionKey(value: unknown): value is CryptoKey {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as CryptoKey).extractable === false &&
    (value as CryptoKey).type === 'secret' &&
    (value as CryptoKey).algorithm.name === 'AES-GCM',
  )
}

function isEncryptedRemoteSession(value: unknown): value is EncryptedRemoteSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<EncryptedRemoteSession>
  return (
    typeof session.iv === 'string' &&
    typeof session.ciphertext === 'string' &&
    typeof session.relayUrl === 'string' &&
    typeof session.ownerCode === 'string' &&
    typeof session.nodeId === 'string' &&
    typeof session.deviceId === 'string' &&
    typeof session.ownerId === 'string' &&
    typeof session.expiresAt === 'string'
  )
}

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function fromBase64Url(value: string) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
