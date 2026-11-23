import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server'
import { ownerSession, passkeyCredential, remoteDevice } from '../db/schema.js'
import type { Database } from '../database.js'
import { AuthDomainError } from './errors.js'
export { AuthDomainError } from './errors.js'

export type WebAuthnProfile = { origin: string; rpId: string }

const CHALLENGE_TTL_MS = 5 * 60_000
const IDLE_TTL_MS = 30 * 24 * 60 * 60_000
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60_000

type Purpose = 'register' | 'authenticate'
type Challenge = {
  challenge: string
  ownerId: string
  purpose: Purpose
  origin: string
  rpId: string
  connectionId: string
  clientPublicKey: string
  deviceId?: string
  userId?: string
  expiresAt: number
  failures?: number
}

export function createOwnerAuthDomain(
  db: Database,
  ownerId: string,
  now = () => Date.now(),
  trustEpoch: () => Promise<number> = async () => 0,
  profile: WebAuthnProfile,
) {
  const challenges = new Map<string, Challenge>()

  async function optionsFor(
    purpose: Purpose,
    binding: Omit<Challenge, 'challenge' | 'ownerId' | 'purpose' | 'expiresAt' | 'failures'>,
  ) {
    const challenge = randomBytes(32).toString('base64url')
    const expiresAt = now() + CHALLENGE_TTL_MS
    const entry: Challenge = {
      ...binding,
      challenge,
      ownerId,
      purpose,
      origin: profile.origin,
      rpId: profile.rpId,
      expiresAt,
      failures: 0,
    }
    challenges.set(challenge, entry)
    if (purpose === 'register') {
      const credentials = await db
        .select({
          credentialId: passkeyCredential.credentialId,
          transports: passkeyCredential.transports,
        })
        .from(passkeyCredential)
        .where(
          and(eq(passkeyCredential.ownerId, ownerId), eq(passkeyCredential.origin, profile.origin)),
        )
      return {
        challengeId: challenge,
        expiresAt: new Date(expiresAt).toISOString(),
        options: await generateRegistrationOptions({
          rpName: 'Codex Web',
          rpID: profile.rpId,
          userID: Buffer.from(ownerId),
          userName: 'Owner',
          userDisplayName: 'Owner',
          challenge: Buffer.from(challenge, 'base64url'),
          timeout: CHALLENGE_TTL_MS,
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
          excludeCredentials: credentials.map((credential) => ({
            id: credential.credentialId,
            transports: credential.transports,
          })),
        }),
      }
    }
    const credentials = await db
      .select({
        credentialId: passkeyCredential.credentialId,
        transports: passkeyCredential.transports,
      })
      .from(passkeyCredential)
      .where(
        and(eq(passkeyCredential.ownerId, ownerId), eq(passkeyCredential.origin, profile.origin)),
      )
    return {
      challengeId: challenge,
      expiresAt: new Date(expiresAt).toISOString(),
      options: await generateAuthenticationOptions({
        rpID: profile.rpId,
        ...(credentials.length
          ? {
              allowCredentials: credentials.map((credential) => ({
                id: credential.credentialId,
                transports: credential.transports,
              })),
            }
          : {}),
        challenge: Buffer.from(challenge, 'base64url'),
        timeout: CHALLENGE_TTL_MS,
        userVerification: 'required',
      }),
    }
  }

  async function registerOptions(
    binding: Omit<Challenge, 'challenge' | 'ownerId' | 'purpose' | 'expiresAt' | 'failures'>,
  ) {
    return optionsFor('register', binding)
  }

  async function authenticationOptions(
    binding: Omit<Challenge, 'challenge' | 'ownerId' | 'purpose' | 'expiresAt' | 'failures'>,
  ) {
    const [count] = await db
      .select({ id: passkeyCredential.id })
      .from(passkeyCredential)
      .where(
        and(eq(passkeyCredential.ownerId, ownerId), eq(passkeyCredential.origin, profile.origin)),
      )
      .limit(1)
    if (!count) throw new AuthDomainError('PASSKEY_REQUIRED')
    return optionsFor('authenticate', binding)
  }

  async function register(
    challengeId: string,
    response: RegistrationResponseJSON,
    binding: Pick<Challenge, 'origin' | 'rpId' | 'connectionId' | 'clientPublicKey'>,
  ) {
    const challenge = consumeChallenge(challengeId, 'register', binding)
    challenges.delete(challengeId)
    try {
      let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>
      try {
        result = await verifyRegistrationResponse({
          response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.origin,
          expectedRPID: challenge.rpId,
          requireUserVerification: true,
        })
      } catch (error) {
        throw new AuthDomainError('PASSKEY_INVALID', { cause: error })
      }
      if (!result.verified || !result.registrationInfo.userVerified)
        throw new AuthDomainError('PASSKEY_INVALID', {
          cause: new Error('Registration did not verify the credential and user presence.'),
        })
      const { credential } = result.registrationInfo
      await db.insert(passkeyCredential).values({
        id: randomUUID(),
        ownerId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: response.response.transports ?? [],
        origin: challenge.origin,
        rpId: challenge.rpId,
      })
      return { registered: true }
    } catch (error) {
      await failChallenge(challenge)
      throw error
    } finally {
      challenges.delete(challengeId)
    }
  }

  async function authenticate(
    challengeId: string,
    response: AuthenticationResponseJSON,
    binding: Pick<Challenge, 'origin' | 'rpId' | 'connectionId' | 'clientPublicKey'>,
    deviceId: string,
  ) {
    const challenge = consumeChallenge(challengeId, 'authenticate', binding)
    try {
      const [credential] = await db
        .select()
        .from(passkeyCredential)
        .where(
          and(
            eq(passkeyCredential.ownerId, ownerId),
            eq(passkeyCredential.credentialId, response.id),
            eq(passkeyCredential.origin, challenge.origin),
            eq(passkeyCredential.rpId, challenge.rpId),
          ),
        )
      if (!credential) throw new Error('INVALID')
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpId,
        requireUserVerification: true,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: credential.counter,
          transports: credential.transports,
        } satisfies WebAuthnCredential,
      })
      if (!verification.verified || !verification.authenticationInfo.userVerified)
        throw new Error('INVALID')
      await db
        .update(passkeyCredential)
        .set({
          counter: verification.authenticationInfo.newCounter,
          lastUsedAt: new Date(now()),
        })
        .where(eq(passkeyCredential.id, credential.id))
      return await createSession(deviceId)
    } catch {
      await failChallenge(challenge)
      throw new AuthDomainError('PASSKEY_INVALID')
    } finally {
      challenges.delete(challengeId)
    }
  }

  async function createSession(deviceId: string) {
    const token = randomBytes(32).toString('base64url')
    const sessionId = randomUUID()
    const nowDate = new Date(now())
    if (deviceId) {
      const [device] = await db
        .select({ id: remoteDevice.id })
        .from(remoteDevice)
        .where(
          and(
            eq(remoteDevice.id, deviceId),
            eq(remoteDevice.ownerId, ownerId),
            isNull(remoteDevice.revokedAt),
          ),
        )
        .limit(1)
      if (!device) throw new AuthDomainError('DEVICE_NOT_FOUND')
    }
    await db.insert(ownerSession).values({
      id: sessionId,
      ownerId,
      deviceId,
      tokenHash: hash(token),
      trustEpoch: await trustEpoch(),
      createdAt: nowDate,
      lastUsedAt: nowDate,
      expiresAt: new Date(now() + IDLE_TTL_MS),
      absoluteExpiresAt: new Date(now() + ABSOLUTE_TTL_MS),
    })
    return { token, sessionId, expiresAt: new Date(now() + IDLE_TTL_MS).toISOString() }
  }

  async function registerDevice(deviceId: string, publicKey: string) {
    await db
      .insert(remoteDevice)
      .values({
        id: deviceId,
        ownerId,
        publicKey,
        createdAt: new Date(now()),
        lastSeenAt: new Date(now()),
      })
      .onConflictDoUpdate({
        target: remoteDevice.id,
        set: { publicKey, revokedAt: null, lastSeenAt: new Date(now()) },
      })
  }

  async function resume(token: string) {
    const [session] = await db
      .select()
      .from(ownerSession)
      .where(
        and(
          eq(ownerSession.ownerId, ownerId),
          eq(ownerSession.tokenHash, hash(token)),
          isNull(ownerSession.revokedAt),
        ),
      )
    if (!session) throw new AuthDomainError('SESSION_REVOKED')
    {
      const [device] = await db
        .select({ id: remoteDevice.id })
        .from(remoteDevice)
        .where(
          and(
            eq(remoteDevice.id, session.deviceId),
            eq(remoteDevice.ownerId, ownerId),
            isNull(remoteDevice.revokedAt),
          ),
        )
        .limit(1)
      if (!device) {
        await db
          .update(ownerSession)
          .set({ revokedAt: new Date(now()) })
          .where(eq(ownerSession.id, session.id))
        throw new AuthDomainError('SESSION_REVOKED')
      }
    }
    if (session.trustEpoch !== (await trustEpoch())) {
      await db
        .update(ownerSession)
        .set({ revokedAt: new Date(now()) })
        .where(eq(ownerSession.id, session.id))
      throw new AuthDomainError('SESSION_REVOKED')
    }
    if (session.expiresAt.getTime() <= now() || session.absoluteExpiresAt.getTime() <= now()) {
      await db
        .update(ownerSession)
        .set({ revokedAt: new Date(now()) })
        .where(eq(ownerSession.id, session.id))
      throw new AuthDomainError('SESSION_EXPIRED')
    }
    const expiresAt = new Date(Math.min(now() + IDLE_TTL_MS, session.absoluteExpiresAt.getTime()))
    await db
      .update(ownerSession)
      .set({ lastUsedAt: new Date(now()), expiresAt })
      .where(eq(ownerSession.id, session.id))
    return { ownerId, sessionId: session.id, sessionToken: token, deviceId: session.deviceId }
  }

  async function logout(token: string) {
    const result = await db
      .update(ownerSession)
      .set({ revokedAt: new Date(now()) })
      .where(
        and(
          eq(ownerSession.ownerId, ownerId),
          eq(ownerSession.tokenHash, hash(token)),
          isNull(ownerSession.revokedAt),
        ),
      )
      .returning({ id: ownerSession.id })
    return { revoked: result.length > 0 }
  }

  async function revokeAllRemoteSessions() {
    const result = await db
      .update(ownerSession)
      .set({ revokedAt: new Date(now()) })
      .where(
        and(
          eq(ownerSession.ownerId, ownerId),
          isNotNull(ownerSession.deviceId),
          isNull(ownerSession.revokedAt),
        ),
      )
      .returning({ id: ownerSession.id })
    return { revoked: result.length }
  }

  async function revokeDeviceSessions(deviceId: string) {
    const result = await db
      .update(ownerSession)
      .set({ revokedAt: new Date(now()) })
      .where(
        and(
          eq(ownerSession.ownerId, ownerId),
          eq(ownerSession.deviceId, deviceId),
          isNull(ownerSession.revokedAt),
        ),
      )
      .returning({ id: ownerSession.id })
    return { revoked: result.length }
  }

  async function markDeviceRevoked(deviceId: string) {
    await db
      .update(remoteDevice)
      .set({ revokedAt: new Date(now()) })
      .where(
        and(
          eq(remoteDevice.ownerId, ownerId),
          eq(remoteDevice.id, deviceId),
          isNull(remoteDevice.revokedAt),
        ),
      )
    return revokeDeviceSessions(deviceId)
  }

  async function revokeAllDevices() {
    const result = await db
      .update(remoteDevice)
      .set({ revokedAt: new Date(now()) })
      .where(and(eq(remoteDevice.ownerId, ownerId), isNull(remoteDevice.revokedAt)))
      .returning({ id: remoteDevice.id })
    await revokeAllRemoteSessions()
    return { revoked: result.length }
  }

  function consumeChallenge(
    id: string,
    purpose: Purpose,
    binding: Pick<Challenge, 'origin' | 'rpId' | 'connectionId' | 'clientPublicKey'>,
  ) {
    const entry = challenges.get(id)
    if (!entry || entry.expiresAt <= now()) {
      challenges.delete(id)
      throw new AuthDomainError('CHALLENGE_EXPIRED')
    }
    if (
      entry.purpose !== purpose ||
      entry.ownerId !== ownerId ||
      entry.origin !== binding.origin ||
      entry.rpId !== binding.rpId ||
      entry.connectionId !== binding.connectionId ||
      entry.clientPublicKey !== binding.clientPublicKey
    ) {
      entry.failures = (entry.failures ?? 0) + 1
      if (entry.failures >= 3) challenges.delete(id)
      throw new AuthDomainError('PASSKEY_INVALID')
    }
    return entry
  }

  async function failChallenge(entry: Challenge) {
    entry.failures = (entry.failures ?? 0) + 1
    if (entry.failures >= 3) challenges.delete(entry.challenge)
  }

  return {
    registerOptions,
    authenticationOptions,
    register,
    authenticate,
    createSession,
    registerDevice,
    async isDeviceAuthorized(deviceId: string) {
      const [device] = await db
        .select({ id: remoteDevice.id })
        .from(remoteDevice)
        .where(
          and(
            eq(remoteDevice.ownerId, ownerId),
            eq(remoteDevice.id, deviceId),
            isNull(remoteDevice.revokedAt),
          ),
        )
        .limit(1)
      return Boolean(device)
    },
    async listActiveDeviceIds() {
      return (
        await db
          .select({ id: remoteDevice.id })
          .from(remoteDevice)
          .where(and(eq(remoteDevice.ownerId, ownerId), isNull(remoteDevice.revokedAt)))
      ).map((device) => device.id)
    },
    resume,
    logout,
    revokeDeviceSessions,
    markDeviceRevoked,
    revokeAllDevices,
    async hasPasskey() {
      const [record] = await db
        .select({ id: passkeyCredential.id })
        .from(passkeyCredential)
        .where(
          and(eq(passkeyCredential.ownerId, ownerId), eq(passkeyCredential.origin, profile.origin)),
        )
        .limit(1)
      return Boolean(record)
    },
  }
}

export function hash(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
