import type { WorkspaceService } from '../../workspace.js'
import type { OwnerMethodContext } from '../session-runtime.js'
import { requireOwner } from '../owner-context.js'
import { OwnerMethodError } from '../errors.js'
import { isRecord, safeId } from './validation.js'
import type { OwnerConnector } from '../../remote/connector.js'
import type { createOwnerAuthDomain } from '../auth-domain.js'
import type { createDeviceManagement } from '../device-management.js'
import type { OwnerTransport } from '../session-runtime.js'
import { AuthDomainError } from '../errors.js'
import { log } from '../../logger.js'

type Dependencies = {
  workspace: Pick<WorkspaceService, 'hasOwner'>
  ownerId?: string
  remote?: OwnerConnector
  authDomain: ReturnType<typeof createOwnerAuthDomain> | undefined
  devices: ReturnType<typeof createDeviceManagement>
  options: { appOrigin?: string; remoteRelayUrl?: string; rpId?: string }
}

export function createAuthenticationOperations(dependencies: Dependencies) {
  const { authDomain, devices, options } = dependencies
  return {
    async ownerStatus(context: OwnerMethodContext) {
      const ownerExists = (await dependencies.workspace.hasOwner?.()) ?? false
      return {
        ownerExists,
        authenticated: context.owner !== null,
        ...(context.owner ? { ownerId: context.owner.ownerId } : {}),
        passkeyAvailable: authDomain ? await authDomain.hasPasskey() : false,
        appOrigin: options.appOrigin ?? null,
      }
    },

    async passkeyRegisterOptions(context: OwnerMethodContext, _input: Record<string, unknown>) {
      const allowed = webauthnTransport(context.transport, options.appOrigin)
      log.info('owner.passkey.registration-options-requested', {
        profile: allowed ? 'remote' : 'unavailable',
        transport: context.transport.kind,
      })
      if (!authDomain || !allowed) throw new OwnerMethodError('WEBAUTHN_ORIGIN_NOT_ALLOWED')
      requireOwner(context)
      return authDomain.registerOptions({
        ...authBinding(context),
        origin: options.appOrigin!,
        rpId: options.rpId!,
      })
    },

    async passkeyRegister(context: OwnerMethodContext, input: Record<string, unknown>) {
      const allowed = webauthnTransport(context.transport, options.appOrigin)
      if (!allowed || !authDomain) throw new OwnerMethodError('WEBAUTHN_ORIGIN_NOT_ALLOWED')
      requireOwner(context)
      if (typeof input.challengeId !== 'string' || !isRecord(input.response))
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const result = await authDomain.register(input.challengeId, input.response as never, {
          ...authBinding(context),
          origin: options.appOrigin!,
          rpId: options.rpId!,
        })
        log.info('owner.passkey.registration-succeeded', { profile: 'remote' })
        return result
      } catch (error) {
        throw new OwnerMethodError('PASSKEY_INVALID', false, { cause: error })
      }
    },

    async passkeyAuthenticationOptions(context: OwnerMethodContext) {
      const allowed = webauthnTransport(context.transport, options.appOrigin)
      if (!authDomain || !allowed) throw new OwnerMethodError('WEBAUTHN_ORIGIN_NOT_ALLOWED')
      try {
        return await authDomain.authenticationOptions({
          ...authBinding(context),
          origin: options.appOrigin!,
          rpId: options.rpId!,
        })
      } catch (error) {
        if (error instanceof AuthDomainError) throw new OwnerMethodError(error.code)
        throw error
      }
    },

    async passkeyAuthenticate(context: OwnerMethodContext, input: Record<string, unknown>) {
      const allowed = webauthnTransport(context.transport, options.appOrigin)
      if (
        !authDomain ||
        !allowed ||
        !context.transport.pairedDeviceId ||
        typeof input.challengeId !== 'string' ||
        !isRecord(input.response)
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const session = await authDomain.authenticate(
          input.challengeId,
          input.response as never,
          {
            ...authBinding(context),
            origin: options.appOrigin!,
            rpId: options.rpId!,
          },
          context.transport.pairedDeviceId,
        )
        await context.authenticate({
          ownerId: dependencies.ownerId!,
          sessionId: session.sessionId,
          sessionToken: session.token,
          stepUpAt: Date.now(),
        })
        return {
          ownerId: dependencies.ownerId!,
          token: session.token,
          expiresAt: session.expiresAt,
        }
      } catch (error) {
        throw new OwnerMethodError(
          error instanceof Error ? error.message : 'PASSKEY_INVALID',
          false,
          { cause: error },
        )
      }
    },

    async enrollmentRedeem(context: OwnerMethodContext, input: Record<string, unknown>) {
      return devices.redeem(context, input)
    },

    async enrollmentIssue(context: OwnerMethodContext) {
      if (!options.appOrigin) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      const owner = requireOwner(context)
      const issuer = context.transport.kind === 'local' ? 'owner-local' : 'paired-device'
      if (issuer === 'paired-device' && authDomain && (await authDomain.hasPasskey())) {
        if (!owner.stepUpAt || Date.now() - owner.stepUpAt > 5 * 60_000)
          throw new OwnerMethodError('STEP_UP_REQUIRED')
      }
      return devices.issue(issuer, owner.transport.pairedDeviceId)
    },
    async enrollmentStatus(context: OwnerMethodContext) {
      requireOwner(context)
      return { ...(await devices.status()), appOrigin: options.appOrigin ?? null }
    },
    async enrollmentCancel(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      return devices.cancel(owner.transport.pairedDeviceId)
    },

    async resumeSession(token: string, transport: OwnerTransport) {
      if (
        transport.kind === 'relay' &&
        (!transport.pairedDeviceId || transport.e2eeVerified !== true)
      )
        return null
      if (!token || token.length > 4096) return null
      if (!authDomain) return null
      try {
        const resumed = await authDomain.resume(token)
        if (transport.kind === 'relay' && resumed.deviceId !== transport.pairedDeviceId) return null
        return resumed
      } catch {
        return null
      }
    },

    async sessionClose(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      if (!owner.sessionToken || !authDomain) throw new OwnerMethodError('UNAUTHORIZED')
      return authDomain.logout(owner.sessionToken)
    },

    async remoteStatus(context: OwnerMethodContext) {
      requireLocalOwner(context)
      if (!dependencies.remote)
        return {
          configured: false,
          connected: false,
          relayUrl: options.remoteRelayUrl ?? null,
        }
      return {
        configured: Boolean(options.remoteRelayUrl),
        connected: dependencies.remote.isConnected(),
        relayUrl: options.remoteRelayUrl ?? null,
        ...(await dependencies.remote.trust.status()),
      }
    },

    async remoteDevices(context: OwnerMethodContext) {
      requireOwner(context)
      return devices.listDevices()
    },
    async remoteDeviceRevoke(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.deviceId)) throw new OwnerMethodError('INVALID_PARAMS')
      return devices.revokeDevice(input.deviceId, owner.transport.pairedDeviceId)
    },
    async remoteDevicesRevokeAll(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      return devices.revokeAllDevices(owner.transport.pairedDeviceId)
    },

    async ownerSecurityStatus(context: OwnerMethodContext) {
      requireOwner(context)
      const registeredDevices = await devices.listDevices()
      const passkeyAvailable = authDomain ? await authDomain.hasPasskey() : false
      return {
        passkeyAvailable,
        appOrigin: options.appOrigin ?? null,
        initialized: true,
        devices: registeredDevices,
        currentDeviceId: context.transport.pairedDeviceId ?? null,
      }
    },
    localManagement: createLocalManagementServices(),
    isDeviceAuthorized: (deviceId: string) =>
      authDomain?.isDeviceAuthorized(deviceId) ?? Promise.resolve(false),
  }
  function createLocalManagementServices() {
    return {
      enrollmentIssue: () => devices.issue('cli'),
      listDevices: () => devices.listDevices(),
      revokeDevice(deviceId: string) {
        if (!safeId(deviceId)) throw new OwnerMethodError('INVALID_PARAMS')
        return devices.revokeDevice(deviceId)
      },
      revokeAllDevices: () => devices.revokeAllDevices(),
    }
  }
}

function requireLocalOwner(context: OwnerMethodContext) {
  requireOwner(context)
  if (context.transport.kind !== 'local') throw new OwnerMethodError('LOCAL_TRANSPORT_REQUIRED')
}

function webauthnTransport(transport: OwnerTransport, appOrigin?: string): boolean {
  return Boolean(appOrigin && transport.kind === 'relay' && transport.e2eeVerified === true)
}

function authBinding(context: OwnerMethodContext) {
  return {
    connectionId: context.connectionId,
    clientPublicKey: context.transport.clientPublicKey ?? 'local',
  }
}
