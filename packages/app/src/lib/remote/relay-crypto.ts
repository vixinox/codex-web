import { RELAY_PROTOCOL_VERSION, type EncryptedFrame } from '@codex-web/protocol/relay'

type CryptoKeyPair = { publicKey: CryptoKey; privateKey: CryptoKey }
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const ecdh = { name: 'ECDH', namedCurve: 'P-256' } as const
const aes = { name: 'AES-GCM', length: 256 } as const

function subtle() {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto API is unavailable')
  return globalThis.crypto.subtle
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

function aad(sequence: number) {
  return encoder.encode(`codex-web-relay/${RELAY_PROTOCOL_VERSION}/${sequence}`)
}

export async function generatePersistentDeviceKeyPair(): Promise<CryptoKeyPair> {
  return (await subtle().generateKey(ecdh, false, ['deriveBits'])) as CryptoKeyPair
}

export async function serializePublicKey(key: CryptoKey) {
  return JSON.stringify(await subtle().exportKey('jwk', key))
}

export async function importPublicKey(serialized: string) {
  return subtle().importKey('jwk', JSON.parse(serialized), ecdh, true, [])
}

export async function deriveSessionKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  context: string,
) {
  const shared = await subtle().deriveBits({ ...ecdh, public: peerPublicKey }, privateKey, 256)
  if (new Uint8Array(shared).every((byte) => byte === 0)) throw new Error('Invalid peer public key')
  const material = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('codex-web-remote-session'),
      info: encoder.encode(context),
    },
    material,
    aes,
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptPayload(
  key: CryptoKey,
  plaintext: string,
  sequence: number,
): Promise<EncryptedFrame> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(sequence) },
    key,
    encoder.encode(plaintext),
  )
  return {
    type: 'encrypted',
    version: RELAY_PROTOCOL_VERSION,
    sequence,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptPayload(key: CryptoKey, frame: EncryptedFrame) {
  const plaintext = await subtle().decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(frame.iv), additionalData: aad(frame.sequence) },
    key,
    base64UrlToBytes(frame.ciphertext),
  )
  return decoder.decode(plaintext)
}
