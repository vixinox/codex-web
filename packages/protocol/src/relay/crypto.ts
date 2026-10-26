import { RELAY_PROTOCOL_VERSION, type EncryptedFrame } from './index.js'

type CryptoKey = object
type CryptoKeyPair = { publicKey: CryptoKey; privateKey: CryptoKey }
type JsonWebKey = Record<string, unknown>
type BufferSource = ArrayBuffer | ArrayBufferView<ArrayBufferLike>
type SubtleLike = {
  generateKey(algorithm: unknown, extractable: boolean, usages: string[]): Promise<CryptoKeyPair>
  exportKey(format: string, key: CryptoKey): Promise<JsonWebKey>
  importKey(
    format: string,
    keyData: unknown,
    algorithm: unknown,
    extractable: boolean,
    usages: string[],
  ): Promise<CryptoKey>
  deriveBits(algorithm: unknown, baseKey: CryptoKey, length: number): Promise<ArrayBuffer>
  deriveKey(
    algorithm: unknown,
    baseKey: CryptoKey,
    derivedKeyAlgorithm: unknown,
    extractable: boolean,
    usages: string[],
  ): Promise<CryptoKey>
  encrypt(algorithm: unknown, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>
  decrypt(algorithm: unknown, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>
}

const cryptoApi = globalThis.crypto

const ECDH_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' } as const
const AES_ALGORITHM = { name: 'AES-GCM', length: 256 } as const
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type SerializedKeyPair = {
  publicKey: string
  privateKey: string
}

export type EncryptedPayload = EncryptedFrame
export type SessionKey = CryptoKey

function subtle() {
  const value = cryptoApi?.subtle as unknown as SubtleLike | undefined
  if (!value) throw new Error('Web Crypto API is unavailable')
  return value
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function textToBytes(value: string) {
  return encoder.encode(value)
}

function aadFor(sequence: number) {
  return textToBytes(`codex-web-relay/${RELAY_PROTOCOL_VERSION}/${sequence}`)
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return (await subtle().generateKey(ECDH_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair
}

export async function generatePersistentDeviceKeyPair(): Promise<CryptoKeyPair> {
  return (await subtle().generateKey(ECDH_ALGORITHM, false, ['deriveBits'])) as CryptoKeyPair
}

export async function serializeKeyPair(keyPair: CryptoKeyPair): Promise<SerializedKeyPair> {
  const [publicKey, privateKey] = await Promise.all([
    subtle().exportKey('jwk', keyPair.publicKey),
    subtle().exportKey('jwk', keyPair.privateKey),
  ])
  return { publicKey: JSON.stringify(publicKey), privateKey: JSON.stringify(privateKey) }
}

export async function serializePublicKey(key: CryptoKey): Promise<string> {
  return JSON.stringify(await subtle().exportKey('jwk', key))
}

export async function importPublicKey(serialized: string) {
  return subtle().importKey('jwk', JSON.parse(serialized) as JsonWebKey, ECDH_ALGORITHM, true, [])
}

export async function importPrivateKey(serialized: string) {
  return subtle().importKey('jwk', JSON.parse(serialized) as JsonWebKey, ECDH_ALGORITHM, true, [
    'deriveBits',
  ])
}

export async function deriveSessionKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  context = 'application-channel',
) {
  const sharedSecret = await subtle().deriveBits(
    { ...ECDH_ALGORITHM, public: peerPublicKey },
    privateKey,
    256,
  )
  // An all-zero result means the peer key was not a valid point on the curve. HKDF would then
  // hand both sides the same predictable key, so treat it as a handshake failure.
  if (new Uint8Array(sharedSecret).every((byte) => byte === 0))
    throw new Error('Invalid peer public key')
  const material = await subtle().importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: textToBytes('codex-web-remote-session'),
      info: textToBytes(context),
    },
    material,
    AES_ALGORITHM,
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptPayload(
  key: CryptoKey,
  plaintext: string,
  sequence: number,
): Promise<EncryptedPayload> {
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(sequence) },
    key,
    textToBytes(plaintext),
  )
  return {
    type: 'encrypted',
    version: RELAY_PROTOCOL_VERSION,
    sequence,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptPayload(key: CryptoKey, frame: EncryptedPayload) {
  const plaintext = await subtle().decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(frame.iv),
      additionalData: aadFor(frame.sequence),
    },
    key,
    base64UrlToBytes(frame.ciphertext),
  )
  return decoder.decode(plaintext)
}

export function randomToken(byteLength = 32) {
  return bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(byteLength)))
}
