import type { OwnerConnector } from '../remote/connector.js'
import { EnrollmentInvitationStore } from '../remote/enrollment-invitation-store.js'
import type { createOwnerAuthDomain } from './auth-domain.js'
import { OwnerMethodError } from './errors.js'
import type { OwnerMethodContext } from './session-runtime.js'

type Auth = ReturnType<typeof createOwnerAuthDomain>

/** Owns the complete device lifecycle shared by authenticated Web and local IPC callers. */
export function createDeviceManagement(
  remote: OwnerConnector | undefined,
  auth: Auth | undefined,
  ownerId: string | undefined,
  appOrigin: string,
  now = () => Date.now(),
) {
  const invitations = new EnrollmentInvitationStore(now)
  let active: { reference: string; expiresAt: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<unknown> = Promise.resolve()

  function run<T>(operation: () => Promise<T>, actorDeviceId?: string): Promise<T> {
    const result = pending.then(async () => {
      if (
        actorDeviceId &&
        (!(await auth?.isDeviceAuthorized(actorDeviceId)) ||
          !(await remote?.listDevices())?.some((device) => device.id === actorDeviceId))
      )
        throw new OwnerMethodError('UNAUTHORIZED')
      return operation()
    })
    pending = result.catch(() => undefined)
    return result
  }

  async function end() {
    const reference = active?.reference
    active = undefined
    invitations.invalidate()
    clearTimeout(timer)
    timer = undefined
    await remote?.unregisterEnrollmentReference(reference)
  }

  async function status() {
    if (active && active.expiresAt <= now()) await end()
    if (active && !remote?.hasEnrollmentReference(active.reference)) await end()
    if (!active) return { active: false as const }
    return {
      active: true as const,
      reference: active.reference,
      expiresAt: new Date(active.expiresAt).toISOString(),
    }
  }

  async function listDevices() {
    if (!remote || !auth) return []
    const authorized = new Set(await auth.listActiveDeviceIds())
    return (await remote.listDevices()).filter((device) => authorized.has(device.id))
  }

  async function remove(deviceId?: string) {
    if (!remote || !auth) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
    try {
      const peers = await remote.listDevices()
      await end()
      if (deviceId) await auth.markDeviceRevoked(deviceId)
      else await auth.revokeAllDevices()
      if (deviceId) await remote.revokeDevice(deviceId)
      else await remote.revokeAllDevices()
      return deviceId ? { revoked: true as const } : { revoked: peers.length }
    } catch (error) {
      // Persistence errors must not leave an already authenticated transport usable.
      try {
        if (deviceId) await remote.revokeDevice(deviceId, 'access_unavailable')
        else await remote.revokeAllDevices('access_unavailable')
      } catch {
        /* The original persistence failure is returned below. */
      } finally {
        await remote.disconnectDevice(deviceId, 'access_unavailable')
      }
      throw error
    }
  }

  return {
    listDevices: () => run(listDevices),
    status: () => run(status),
    issue(issuer: 'owner-local' | 'cli' | 'paired-device', actorDeviceId?: string) {
      return run(async () => {
        if (!remote?.isConnected() || !auth || !ownerId)
          throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
        await end()
        const identity = await remote.trust.identity()
        const issued = invitations.issue({
          ownerId,
          nodeId: identity.nodeId,
          trustEpoch: identity.trustEpoch,
          issuer,
          ...(actorDeviceId ? { issuerDeviceId: actorDeviceId } : {}),
        })
        active = issued
        try {
          await remote.registerEnrollmentReference(issued.reference, issued.expiresAt)
        } catch (error) {
          await end()
          throw error
        }
        timer = setTimeout(
          () => {
            void run(async () => {
              if (active?.reference === issued.reference) await end()
            }).catch(() => undefined)
          },
          Math.max(0, issued.expiresAt - now()),
        )
        timer.unref?.()
        return {
          reference: issued.reference,
          expiresAt: new Date(issued.expiresAt).toISOString(),
          appOrigin,
        }
      }, actorDeviceId)
    },
    cancel(actorDeviceId?: string) {
      return run(async () => {
        const current = await status()
        await end()
        return { cancelled: current.active }
      }, actorDeviceId)
    },
    revokeDevice: (id: string, actorDeviceId?: string) => run(() => remove(id), actorDeviceId),
    revokeAllDevices: (actorDeviceId?: string) => run(() => remove(), actorDeviceId),
    redeem(context: OwnerMethodContext, input: Record<string, unknown>) {
      return run(async () => {
        const { transport } = context
        if (
          transport.kind !== 'relay' ||
          !transport.enrollmentCandidate ||
          transport.e2eeVerified !== true ||
          !transport.clientPublicKey
        )
          throw new OwnerMethodError('AUTH_FAILURE')
        const reference = transport.enrollmentReference
        if (
          !reference ||
          input.reference !== reference ||
          Object.keys(input).some((key) => key !== 'reference') ||
          !remote ||
          !auth
        )
          throw new OwnerMethodError('INVALID_PARAMS')
        const current = await status()
        const identity = await remote.trust.identity()
        if (!ownerId) throw new OwnerMethodError('AUTH_UNAVAILABLE')
        if (
          !current.active ||
          !invitations.consume(reference, {
            ownerId,
            nodeId: identity.nodeId,
            trustEpoch: identity.trustEpoch,
            clientPublicKey: transport.clientPublicKey,
          })
        )
          throw new OwnerMethodError('RESOURCE_NOT_FOUND')
        await end()
        let createdDeviceId: string | undefined
        let sessionToken: string | undefined
        try {
          const trusted = await remote.trust.trustPeerWithStatus(transport.clientPublicKey)
          if (trusted.created) {
            createdDeviceId = trusted.deviceId
            await auth.registerDevice(trusted.deviceId, transport.clientPublicKey)
          } else if (!(await auth.isDeviceAuthorized(trusted.deviceId))) {
            throw new OwnerMethodError('UNAUTHORIZED')
          }
          const session = await auth.createSession(trusted.deviceId)
          sessionToken = session.token
          const clientToken = await remote.createPairedClientToken(trusted.deviceId)
          await context.authenticate({
            ownerId,
            sessionId: session.sessionId,
            sessionToken: session.token,
          })
          transport.promote?.(trusted.deviceId, clientToken)
          return {
            ownerId,
            nodeId: identity.nodeId,
            ownerPublicKey: identity.ownerPublicKey,
            sessionToken: session.token,
            expiresAt: session.expiresAt,
            deviceId: trusted.deviceId,
            clientToken,
            trustEpoch: identity.trustEpoch,
          }
        } catch (error) {
          context.unauthenticate()
          if (sessionToken) await auth.logout(sessionToken).catch(() => undefined)
          if (createdDeviceId) {
            await Promise.allSettled([
              auth.markDeviceRevoked(createdDeviceId),
              remote.revokeDevice(createdDeviceId, 'access_unavailable'),
            ])
            await remote.disconnectDevice(createdDeviceId, 'access_unavailable')
          }
          throw new OwnerMethodError('INTERNAL_ERROR', true, { cause: error })
        }
      })
    },
  }
}
