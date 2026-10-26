import {
  generatePersistentDeviceKeyPair,
  serializePublicKey,
} from '@codex-web/protocol/relay/crypto'

export type DeviceKeyRecord = {
  deviceId: string | null
  publicKey: string
  privateKey: CryptoKey
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
      { deviceId: null, publicKey, privateKey: pair.privateKey },
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
    return value
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

export async function clearDeviceKey() {
  await deleteStoredKey()
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

function isDeviceKeyRecord(value: unknown): value is DeviceKeyRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<DeviceKeyRecord>
  return (
    (record.deviceId === null || typeof record.deviceId === 'string') &&
    typeof record.publicKey === 'string' &&
    record.publicKey.length > 0 &&
    !!record.privateKey &&
    typeof record.privateKey === 'object' &&
    (record.privateKey as CryptoKey).extractable === false
  )
}
