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
const PROFILE_STORE_NAME = 'connection-profiles'

export type EncryptedProfileSession = {
  iv: string
  ciphertext: string
  relayUrl: string
  nodeId: string
  ownerId: string
  ownerPublicKey: string
  deviceId: string
  trustEpoch: number
  expiresAt: string
}

export type ConnectionProfileRecord = {
  id: string
  label: string
  relayUrl: string
  nodeId: string
  ownerId: string
  ownerPublicKey: string
  deviceId: string | null
  publicKey: string
  privateKey: CryptoKey
  pairedClientToken: string | null
  trustEpoch: number | null
  sessionKey: CryptoKey | null
  encryptedSession: EncryptedProfileSession | null
  createdAt: string
  lastConnectedAt: string | null
}

export type ConnectionProfileSummary = Pick<
  ConnectionProfileRecord,
  'id' | 'label' | 'createdAt' | 'lastConnectedAt'
> & {
  paired: boolean
  hasSession: boolean
  sessionExpiresAt: string | null
}

function openDatabase(): Promise<KeyDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3)
    request.onupgradeneeded = () => {
      if (request.result.objectStoreNames.contains(STORE_NAME))
        request.result.deleteObjectStore(STORE_NAME)
      if (!request.result.objectStoreNames.contains(PROFILE_STORE_NAME))
        request.result.createObjectStore(PROFILE_STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open device key store'))
  })
}

export async function createConnectionProfileDraft(input: {
  label: string
  relayUrl: string
}): Promise<{ id: string; publicKey: string; privateKey: CryptoKey }> {
  const pair = await generatePersistentDeviceKeyPair()
  const id = crypto.randomUUID()
  const record: ConnectionProfileRecord = {
    id,
    label: normalizeProfileLabel(input.label),
    relayUrl: input.relayUrl,
    nodeId: '',
    ownerId: '',
    ownerPublicKey: '',
    deviceId: null,
    publicKey: await serializePublicKey(pair.publicKey),
    privateKey: pair.privateKey,
    pairedClientToken: null,
    trustEpoch: null,
    sessionKey: null,
    encryptedSession: null,
    createdAt: new Date().toISOString(),
    lastConnectedAt: null,
  }
  await putConnectionProfile(record)
  return { id, publicKey: record.publicKey, privateKey: record.privateKey }
}

export async function completeConnectionProfile(input: {
  id: string
  label?: string
  nodeId: string
  ownerId: string
  ownerPublicKey: string
  deviceId: string
  pairedClientToken: string
  trustEpoch: number
  sessionToken: string
  sessionExpiresAt: string
}): Promise<ConnectionProfileSummary> {
  const profile = await loadConnectionProfile(input.id)
  if (!profile) throw new Error('Connection profile is missing')
  if (
    !input.nodeId ||
    !input.ownerId ||
    !input.ownerPublicKey ||
    !input.deviceId ||
    !input.pairedClientToken ||
    !input.sessionToken ||
    !Number.isSafeInteger(input.trustEpoch) ||
    !Number.isFinite(Date.parse(input.sessionExpiresAt)) ||
    Date.parse(input.sessionExpiresAt) <= Date.now()
  )
    throw new Error('Enrollment returned an invalid connection profile.')
  const sessionKey = await createProfileSessionKey(profile.sessionKey)
  const encryptedSession = await encryptConnectionProfileSession(sessionKey, input.sessionToken, {
    relayUrl: profile.relayUrl,
    nodeId: input.nodeId,
    ownerId: input.ownerId,
    ownerPublicKey: input.ownerPublicKey,
    deviceId: input.deviceId,
    trustEpoch: input.trustEpoch,
    expiresAt: input.sessionExpiresAt,
  })
  const completed: ConnectionProfileRecord = {
    ...profile,
    label: normalizeProfileLabel(input.label ?? profile.label),
    nodeId: input.nodeId,
    ownerId: input.ownerId,
    ownerPublicKey: input.ownerPublicKey,
    deviceId: input.deviceId,
    pairedClientToken: input.pairedClientToken,
    trustEpoch: input.trustEpoch,
    sessionKey,
    encryptedSession,
    lastConnectedAt: new Date().toISOString(),
  }
  await putConnectionProfile(completed)
  return toConnectionProfileSummary(completed)
}

export async function listConnectionProfiles(): Promise<ConnectionProfileSummary[]> {
  const records = await getAllConnectionProfiles()
  const valid = records.filter(isConnectionProfileRecord)
  if (valid.length !== records.length) {
    const invalidIds = records.filter((record) => !isConnectionProfileRecord(record))
    await deleteConnectionProfiles(invalidIds.map((record) => getProfileId(record)))
  }
  return valid.map(toConnectionProfileSummary).sort((a, b) => a.label.localeCompare(b.label))
}

export async function loadConnectionProfile(id: string): Promise<ConnectionProfileRecord | null> {
  const db = await openDatabase()
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(PROFILE_STORE_NAME).objectStore(PROFILE_STORE_NAME).get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (value === undefined) return null
    if (!isConnectionProfileRecord(value)) {
      await deleteConnectionProfiles([id])
      return null
    }
    return value
  } finally {
    db.close()
  }
}

export async function saveConnectionProfileSession(
  id: string,
  input: { token: string; expiresAt: string },
) {
  const profile = await requirePairedProfile(id)
  if (Date.parse(input.expiresAt) <= Date.now()) throw new Error('Session is expired')
  const sessionKey = await createProfileSessionKey(profile.sessionKey)
  const encryptedSession = await encryptConnectionProfileSession(sessionKey, input.token, {
    relayUrl: profile.relayUrl,
    nodeId: profile.nodeId,
    ownerId: profile.ownerId,
    ownerPublicKey: profile.ownerPublicKey,
    deviceId: profile.deviceId!,
    trustEpoch: profile.trustEpoch!,
    expiresAt: input.expiresAt,
  })
  await putConnectionProfile({ ...profile, sessionKey, encryptedSession })
}

export async function loadConnectionProfileSession(id: string): Promise<{
  token: string
  expiresAt: string
  ownerId: string
} | null> {
  const profile = await loadConnectionProfile(id)
  const encrypted = profile?.encryptedSession
  if (!profile?.sessionKey || !encrypted || !isProfilePaired(profile)) return null
  if (
    !matchesProfileIdentity(profile, encrypted) ||
    !Number.isFinite(Date.parse(encrypted.expiresAt)) ||
    Date.parse(encrypted.expiresAt) <= Date.now()
  ) {
    await clearConnectionProfileSession(id)
    return null
  }
  try {
    const token = await decryptConnectionProfileSession(profile.sessionKey, encrypted)
    return { token, expiresAt: encrypted.expiresAt, ownerId: profile.ownerId }
  } catch {
    await clearConnectionProfileSession(id)
    return null
  }
}

export async function clearConnectionProfileSession(id: string) {
  const profile = await loadConnectionProfile(id)
  if (!profile || (!profile.sessionKey && !profile.encryptedSession)) return
  await putConnectionProfile({ ...profile, sessionKey: null, encryptedSession: null })
}

export async function updateConnectionProfileLastConnected(id: string) {
  const profile = await loadConnectionProfile(id)
  if (!profile) throw new Error('Connection profile is missing')
  await putConnectionProfile({ ...profile, lastConnectedAt: new Date().toISOString() })
}

export async function removeConnectionProfile(id: string) {
  await deleteConnectionProfiles([id])
}

export function toConnectionProfileSummary(
  profile: ConnectionProfileRecord,
): ConnectionProfileSummary {
  return {
    id: profile.id,
    label: profile.label,
    createdAt: profile.createdAt,
    lastConnectedAt: profile.lastConnectedAt,
    paired: isProfilePaired(profile),
    hasSession: Boolean(profile.encryptedSession),
    sessionExpiresAt: profile.encryptedSession?.expiresAt ?? null,
  }
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
    iv: profileToBase64Url(iv),
    ciphertext: profileToBase64Url(new Uint8Array(ciphertext)),
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
      iv: profileFromBase64Url(iv),
      additionalData: new TextEncoder().encode(JSON.stringify(metadata)),
    },
    key,
    profileFromBase64Url(ciphertext),
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

async function putConnectionProfile(profile: ConnectionProfileRecord) {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PROFILE_STORE_NAME, 'readwrite')
      tx.objectStore(PROFILE_STORE_NAME).put(profile)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Unable to persist connection profile'))
      tx.onabort = () => reject(tx.error ?? new Error('Unable to persist connection profile'))
    })
  } finally {
    db.close()
  }
}

async function getAllConnectionProfiles(): Promise<unknown[]> {
  const db = await openDatabase()
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction(PROFILE_STORE_NAME).objectStore(PROFILE_STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function deleteConnectionProfiles(ids: string[]) {
  if (ids.length === 0) return
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PROFILE_STORE_NAME, 'readwrite')
      const store = tx.objectStore(PROFILE_STORE_NAME)
      for (const id of ids) store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Unable to remove connection profile'))
      tx.onabort = () => reject(tx.error ?? new Error('Unable to remove connection profile'))
    })
  } finally {
    db.close()
  }
}

async function requirePairedProfile(id: string) {
  const profile = await loadConnectionProfile(id)
  if (!profile || !isProfilePaired(profile)) throw new Error('Paired connection profile is missing')
  return profile
}

function isProfilePaired(profile: ConnectionProfileRecord): boolean {
  return Boolean(
    profile.deviceId &&
    profile.pairedClientToken &&
    profile.nodeId &&
    profile.ownerId &&
    profile.ownerPublicKey &&
    Number.isSafeInteger(profile.trustEpoch),
  )
}

function matchesProfileIdentity(
  profile: ConnectionProfileRecord,
  session: EncryptedProfileSession,
): boolean {
  return (
    session.relayUrl === profile.relayUrl &&
    session.nodeId === profile.nodeId &&
    session.ownerId === profile.ownerId &&
    session.ownerPublicKey === profile.ownerPublicKey &&
    session.deviceId === profile.deviceId &&
    session.trustEpoch === profile.trustEpoch
  )
}

async function createProfileSessionKey(existing: CryptoKey | null) {
  return (
    existing ??
    (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]))
  )
}

export async function encryptConnectionProfileSession(
  key: CryptoKey,
  token: string,
  metadata: Omit<EncryptedProfileSession, 'iv' | 'ciphertext'>,
): Promise<EncryptedProfileSession> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(JSON.stringify(metadata)) },
    key,
    new TextEncoder().encode(token),
  )
  return {
    ...metadata,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptConnectionProfileSession(
  key: CryptoKey,
  encrypted: EncryptedProfileSession,
) {
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

function isConnectionProfileRecord(value: unknown): value is ConnectionProfileRecord {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<ConnectionProfileRecord>
  const draft = profile.deviceId === null && profile.pairedClientToken === null
  return (
    typeof profile.id === 'string' &&
    profile.id.length > 0 &&
    typeof profile.label === 'string' &&
    profile.label.length > 0 &&
    typeof profile.relayUrl === 'string' &&
    (draft || typeof profile.nodeId === 'string') &&
    (draft || typeof profile.ownerId === 'string') &&
    (draft || typeof profile.ownerPublicKey === 'string') &&
    (profile.deviceId === null || typeof profile.deviceId === 'string') &&
    typeof profile.publicKey === 'string' &&
    profile.publicKey.length > 0 &&
    isNonExportableEcdhPrivateKey(profile.privateKey) &&
    (profile.pairedClientToken === null || typeof profile.pairedClientToken === 'string') &&
    (profile.trustEpoch === null ||
      (profile.trustEpoch !== undefined &&
        Number.isSafeInteger(profile.trustEpoch) &&
        profile.trustEpoch >= 0)) &&
    (profile.sessionKey === null || isAesSessionKey(profile.sessionKey)) &&
    (profile.encryptedSession === null || isEncryptedProfileSession(profile.encryptedSession)) &&
    typeof profile.createdAt === 'string' &&
    (profile.lastConnectedAt === null || typeof profile.lastConnectedAt === 'string')
  )
}

function isNonExportableEcdhPrivateKey(value: unknown): value is CryptoKey {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as CryptoKey).extractable === false &&
    (value as CryptoKey).type === 'private' &&
    (value as CryptoKey).algorithm.name === 'ECDH',
  )
}

function isEncryptedProfileSession(value: unknown): value is EncryptedProfileSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<EncryptedProfileSession>
  return (
    typeof session.iv === 'string' &&
    typeof session.ciphertext === 'string' &&
    typeof session.relayUrl === 'string' &&
    typeof session.nodeId === 'string' &&
    typeof session.ownerId === 'string' &&
    typeof session.ownerPublicKey === 'string' &&
    typeof session.deviceId === 'string' &&
    Number.isSafeInteger(session.trustEpoch) &&
    typeof session.expiresAt === 'string'
  )
}

function getProfileId(value: unknown) {
  return value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
    ? (value as { id: string }).id
    : ''
}

function normalizeProfileLabel(value: string) {
  const label = value.trim().slice(0, 80)
  return label || 'Owner connection'
}

function profileToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function profileFromBase64Url(value: string) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
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
