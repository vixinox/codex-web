import { createHash, randomUUID } from 'node:crypto'
import type { CodexBridge } from '../http/types.js'
import { projectThreadSnapshot } from '../codex/domain-events.js'
import { parseOwnerEventCursor, type OwnerEventCursor } from '@codex-web/protocol/owner'
import { parseRequestId } from '../codex/request-id.js'
import { createThreadDomain } from '../threads/index.js'
import { SkillHandleStore, skillsForCwd, turnInput } from '../skills.js'
import { parseSkillHandles, resolveSelectedSkills } from './skill-selection.js'
import type { WorkspaceService } from '../workspace.js'
import type { OwnerConnector } from '../remote/connector.js'
import { EnrollmentInvitationStore } from '../remote/enrollment-invitation-store.js'
import { OwnerMethodError } from './errors.js'
import type { OwnerContext, OwnerMethodContext, OwnerTransport } from './session-runtime.js'
import { createOwnerAuthDomain, WEBAUTHN_PROFILES, type WebAuthnProfiles } from './auth-domain.js'
import { AuthDomainError } from './errors.js'
import type { Database } from '../database.js'
import { log } from '../logger.js'

const MAX_INITIAL_MESSAGE_LENGTH = 256_000
const SUBSCRIPTION_TTL_MS = 10 * 60 * 1000
const PROCESS_EVENT_EPOCH = randomUUID()

export type { OwnerEventCursor } from '@codex-web/protocol/owner'

function eventEpoch(ownerId: string) {
  return createHash('sha256').update(`${PROCESS_EVENT_EPOCH}:${ownerId}`).digest('base64url')
}

function makeEventCursor(ownerId: string, sequence: number): OwnerEventCursor {
  return { epoch: eventEpoch(ownerId), sequence }
}

function parseEventCursor(value: unknown): OwnerEventCursor | null | undefined {
  if (value === undefined) return undefined
  return parseOwnerEventCursor(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function mapThreadAccessFailure(kind: string): OwnerMethodError {
  switch (kind) {
    case 'project_not_found':
      return new OwnerMethodError('PROJECT_NOT_FOUND')
    case 'codex_start_required':
      return new OwnerMethodError('CODEX_START_REQUIRED', true)
    case 'invalid_projection':
      return new OwnerMethodError('CODEX_PROTOCOL_ERROR', true)
    case 'not_found':
      return new OwnerMethodError('THREAD_NOT_FOUND')
    default:
      return new OwnerMethodError('CODEX_UNAVAILABLE', true)
  }
}

export type OwnerApplicationServiceDependencies = {
  workspace: WorkspaceService & {
    hasOwner?: () => Promise<boolean>
    getOnlyOwnerId: () => Promise<string | null>
  }
  codex: CodexBridge
  remote?: OwnerConnector
  ownerId?: string
  database?: Database
}

export type OwnerApplicationServiceOptions = {
  trustedOrigins: readonly string[]
  requireDangerousAccessConfirmation?: boolean
  remoteRelayUrl?: string
  appOrigin?: string
  rpId?: string
}

export type OwnerApplicationServices = ReturnType<typeof createOwnerApplicationServices>

export function createOwnerApplicationServices(
  dependencies: OwnerApplicationServiceDependencies,
  options: OwnerApplicationServiceOptions,
) {
  const authDomain =
    dependencies.database && dependencies.ownerId
      ? createOwnerAuthDomain(
          dependencies.database,
          dependencies.ownerId,
          () => Date.now(),
          async () =>
            dependencies.remote ? (await dependencies.remote.trust.identity()).trustEpoch : 0,
          {
            local: WEBAUTHN_PROFILES.local,
            remote: {
              origin: options.appOrigin ?? WEBAUTHN_PROFILES.remote.origin,
              rpId: options.rpId ?? WEBAUTHN_PROFILES.remote.rpId,
            },
          } satisfies WebAuthnProfiles,
        )
      : undefined
  const enrollmentInvitations = new EnrollmentInvitationStore()
  let activeEnrollmentReference: string | undefined
  let enrollmentTimer: ReturnType<typeof setTimeout> | undefined
  async function issueEnrollmentInvitation(
    issuer: 'owner-local' | 'cli' | 'paired-device',
    issuerDeviceId?: string,
  ) {
    if (
      !dependencies.remote ||
      !options.remoteRelayUrl ||
      !dependencies.ownerId ||
      !dependencies.remote.isConnected()
    )
      throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
    const identity = await dependencies.remote.trust.identity()
    await dependencies.remote.unregisterEnrollmentReference(activeEnrollmentReference)
    activeEnrollmentReference = undefined
    if (enrollmentTimer) clearTimeout(enrollmentTimer)
    const issued = enrollmentInvitations.issue({
      ownerId: dependencies.ownerId,
      nodeId: identity.nodeId,
      trustEpoch: identity.trustEpoch,
      issuer,
      ...(issuerDeviceId ? { issuerDeviceId } : {}),
    })
    activeEnrollmentReference = issued.reference
    await dependencies.remote.registerEnrollmentReference(issued.reference, issued.expiresAt)
    enrollmentTimer = setTimeout(
      () => {
        if (activeEnrollmentReference !== issued.reference) return
        enrollmentInvitations.invalidate()
        activeEnrollmentReference = undefined
        void dependencies.remote?.unregisterEnrollmentReference(issued.reference)
      },
      Math.max(0, issued.expiresAt - Date.now()),
    )
    return {
      reference: issued.reference,
      expiresAt: new Date(issued.expiresAt).toISOString(),
      issuer,
      appOrigin: options.appOrigin ?? WEBAUTHN_PROFILES.remote.origin,
    }
  }
  const threadDomain = createThreadDomain({
    workspace: dependencies.workspace,
    codex: dependencies.codex,
  })
  const skillHandles = new SkillHandleStore()
  const subscriptions = new Map<
    string,
    {
      ownerId: string
      sessionId: string
      scope: 'thread' | 'workspace'
      threadId?: string
      expiresAt: number
    }
  >()
  const services = {
    async ownerStatus(context: OwnerMethodContext) {
      const ownerExists = (await dependencies.workspace.hasOwner?.()) ?? false
      return {
        ownerExists,
        authenticated: context.owner !== null,
        ...(context.owner ? { ownerId: context.owner.ownerId } : {}),
        ...(authDomain ? { remotePasskeyAvailable: await authDomain.hasPasskey('remote') } : {}),
      }
    },

    async passkeyRegisterOptions(context: OwnerMethodContext, _input: Record<string, unknown>) {
      const profile = webauthnProfile(context.transport)
      log.info('owner.passkey.registration-options-requested', {
        profile: profile ?? 'unavailable',
        transport: context.transport.kind,
      })
      if (!authDomain || !profile) throw new OwnerMethodError('WEBAUTHN_ORIGIN_NOT_ALLOWED')
      if (profile === 'remote') requireOwner(context)
      else if (context.owner) requireOwner(context)
      const ticket = profile === 'local' ? context.enrollmentTicket : undefined
      return authDomain.registerOptions(profile, authBinding(context), ticket)
    },

    async passkeyRegister(context: OwnerMethodContext, input: Record<string, unknown>) {
      const profile = webauthnProfile(context.transport)
      if (profile === 'remote') requireOwner(context)
      else if (profile !== 'local') throw new OwnerMethodError('WEBAUTHN_ORIGIN_NOT_ALLOWED')
      if (
        !authDomain ||
        !profile ||
        typeof input.challengeId !== 'string' ||
        !isRecord(input.response)
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const result = await authDomain.register(input.challengeId, input.response as never, {
          ...authBinding(context),
          profile,
          ...(typeof input.ticket === 'string' ? { ticket: input.ticket } : {}),
        })
        log.info('owner.passkey.registration-succeeded', { profile })
        return result
      } catch (error) {
        throw new OwnerMethodError('PASSKEY_INVALID', false, { cause: error })
      }
    },

    async passkeyAuthenticationOptions(context: OwnerMethodContext) {
      const profile = webauthnProfile(context.transport)
      if (!authDomain || !profile) throw new OwnerMethodError('WEBAUTHN_ORIGIN_NOT_ALLOWED')
      try {
        return await authDomain.authenticationOptions(profile, authBinding(context))
      } catch (error) {
        if (error instanceof AuthDomainError) throw new OwnerMethodError(error.code)
        throw error
      }
    },

    async passkeyAuthenticate(context: OwnerMethodContext, input: Record<string, unknown>) {
      const profile = webauthnProfile(context.transport)
      if (
        !authDomain ||
        !profile ||
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
            profile,
          },
          profile === 'remote' && context.transport.pairedDeviceId
            ? context.transport.pairedDeviceId
            : undefined,
        )
        await context.authenticate({
          ownerId: dependencies.ownerId!,
          sessionId: session.sessionId,
          sessionToken: session.token,
          stepUpAt: Date.now(),
        })
        return { token: session.token, expiresAt: session.expiresAt }
      } catch (error) {
        throw new OwnerMethodError(
          error instanceof Error ? error.message : 'PASSKEY_INVALID',
          false,
          { cause: error },
        )
      }
    },

    async enrollmentRedeem(context: OwnerMethodContext, input: Record<string, unknown>) {
      if (
        context.transport.kind !== 'relay' ||
        !context.transport.enrollmentCandidate ||
        context.transport.e2eeVerified !== true ||
        !context.transport.clientPublicKey
      )
        throw new OwnerMethodError('AUTH_FAILURE')
      const reference = context.transport.enrollmentReference
      if (
        !reference ||
        input.reference !== reference ||
        Object.keys(input).some((key) => key !== 'reference') ||
        !dependencies.remote ||
        !authDomain
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      const identity = await dependencies.remote.trust.identity()
      const ownerId = dependencies.ownerId
      if (!ownerId) throw new OwnerMethodError('AUTH_UNAVAILABLE')
      if (
        !enrollmentInvitations.consume(reference, {
          ownerId,
          nodeId: identity.nodeId,
          trustEpoch: identity.trustEpoch,
          clientPublicKey: context.transport.clientPublicKey,
        })
      ) {
        throw new OwnerMethodError('RESOURCE_NOT_FOUND')
      }
      await dependencies.remote.unregisterEnrollmentReference(reference)
      activeEnrollmentReference = undefined
      if (enrollmentTimer) clearTimeout(enrollmentTimer)
      enrollmentTimer = undefined
      const trusted = await dependencies.remote.trust.trustPeerWithStatus(
        context.transport.clientPublicKey,
      )
      if (!trusted.created) {
        throw new OwnerMethodError('RESOURCE_NOT_FOUND')
      }
      try {
        await authDomain.registerDevice(trusted.deviceId, context.transport.clientPublicKey)
        const session = await authDomain.createSession(trusted.deviceId)
        const clientToken = await dependencies.remote.createPairedClientToken(trusted.deviceId)
        const currentIdentity = await dependencies.remote.trust.identity()
        await context.authenticate({
          ownerId,
          sessionId: session.sessionId,
          sessionToken: session.token,
        })
        context.transport.promote?.(trusted.deviceId, clientToken)
        return {
          ownerId,
          nodeId: currentIdentity.nodeId,
          ownerPublicKey: currentIdentity.ownerPublicKey,
          sessionToken: session.token,
          expiresAt: session.expiresAt,
          deviceId: trusted.deviceId,
          clientToken,
          trustEpoch: currentIdentity.trustEpoch,
        }
      } catch {
        await dependencies.remote.revokeDevice(trusted.deviceId).catch(() => false)
        await authDomain.markDeviceRevoked(trusted.deviceId).catch(() => undefined)
        throw new OwnerMethodError('INTERNAL_ERROR', true)
      }
    },

    async localEnrollmentTicketIssue(_context: OwnerMethodContext) {
      if (!authDomain) throw new OwnerMethodError('AUTH_UNAVAILABLE')
      return authDomain.issueLocalEnrollmentTicket()
    },

    async remoteSessionsRevokeAll(context: OwnerMethodContext) {
      requireOwner(context)
      if (!authDomain) throw new OwnerMethodError('AUTH_UNAVAILABLE')
      return authDomain.revokeAllRemoteSessions()
    },

    async enrollmentIssue(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      const issuer = context.transport.kind === 'local' ? 'owner-local' : 'paired-device'
      if (issuer === 'paired-device' && authDomain && (await authDomain.hasPasskey('remote'))) {
        const stepUpAt = owner.stepUpAt
        if (!stepUpAt || Date.now() - stepUpAt > 5 * 60_000)
          throw new OwnerMethodError('STEP_UP_REQUIRED')
      }
      if (!owner.ownerId) throw new OwnerMethodError('UNAUTHORIZED')
      return issueEnrollmentInvitation(issuer, owner.transport.pairedDeviceId)
    },

    async enrollmentStatus(context: OwnerMethodContext) {
      requireOwner(context)
      const status = enrollmentInvitations.status()
      if (
        !status ||
        !activeEnrollmentReference ||
        !dependencies.remote?.hasEnrollmentReference(activeEnrollmentReference)
      ) {
        enrollmentInvitations.invalidate()
        activeEnrollmentReference = undefined
        return { active: false }
      }
      return {
        active: true,
        reference: activeEnrollmentReference,
        expiresAt: new Date(status.expiresAt).toISOString(),
        consumed: status.consumed,
        issuer: status.issuer,
      }
    },

    async enrollmentCancel(context: OwnerMethodContext) {
      requireOwner(context)
      const cancelled = enrollmentInvitations.cancel()
      await dependencies.remote?.unregisterEnrollmentReference(activeEnrollmentReference)
      activeEnrollmentReference = undefined
      if (enrollmentTimer) clearTimeout(enrollmentTimer)
      enrollmentTimer = undefined
      return { cancelled }
    },

    async enrollmentInvalidate() {
      enrollmentInvitations.invalidate()
      await dependencies.remote?.unregisterEnrollmentReference(activeEnrollmentReference)
      activeEnrollmentReference = undefined
      if (enrollmentTimer) clearTimeout(enrollmentTimer)
      enrollmentTimer = undefined
      return { invalidated: true }
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

    async credentialsList(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      return {
        credentials: await dependencies.workspace.listCredentials(owner.ownerId),
        currentCredentialId: await dependencies.workspace.getCurrentCredentialId(owner.ownerId),
      }
    },

    async credentialSelect(context: OwnerMethodContext, input: { credentialId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.credentialId !== 'string' || !input.credentialId)
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      if (!(await dependencies.workspace.setCurrentCredentialId(owner.ownerId, input.credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      return { currentCredentialId: input.credentialId }
    },

    async credentialCreate(
      context: OwnerMethodContext,
      input: { provider?: unknown; baseUrl?: unknown; apiKey?: unknown },
    ) {
      const owner = requireOwner(context)
      if (
        typeof input.provider !== 'string' ||
        typeof input.baseUrl !== 'string' ||
        typeof input.apiKey !== 'string'
      )
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      try {
        const saved = await dependencies.workspace.saveCredential(owner.ownerId, {
          provider: input.provider,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
        })
        dependencies.codex.markCredentialPending?.(owner.ownerId, saved.id)
        return saved
      } catch {
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      }
    },

    async credentialTest(context: OwnerMethodContext, input: { credentialId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.credentialId !== 'string' || !input.credentialId)
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      if (!(await dependencies.workspace.getCredential(owner.ownerId, input.credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      try {
        await dependencies.workspace.testCredential(owner.ownerId, input.credentialId)
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
      return { ok: true }
    },

    async credentialDelete(context: OwnerMethodContext, input: { credentialId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.credentialId !== 'string' || !input.credentialId)
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      if (!(await dependencies.workspace.deleteCredential(owner.ownerId, input.credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      await dependencies.codex.stop?.(owner.ownerId)
      return { deleted: true }
    },

    async projectsList(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      return { projects: await dependencies.workspace.listProjects(owner.ownerId) }
    },

    async projectCreate(context: OwnerMethodContext, input: { name?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.name !== 'string') throw new OwnerMethodError('INVALID_PARAMS')
      try {
        return await dependencies.workspace.createProject(owner.ownerId, input.name)
      } catch (error) {
        if (error instanceof Error && error.name === 'ProjectConflictError')
          throw new OwnerMethodError('PROJECT_EXISTS')
        throw new OwnerMethodError('INVALID_PARAMS')
      }
    },

    async projectRename(
      context: OwnerMethodContext,
      input: { projectId?: unknown; name?: unknown },
    ) {
      const owner = requireOwner(context)
      if (typeof input.projectId !== 'string' || typeof input.name !== 'string')
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const renamed = await dependencies.workspace.renameProject(
          owner.ownerId,
          input.projectId,
          input.name,
        )
        if (!renamed) throw new OwnerMethodError('PROJECT_NOT_FOUND')
        return renamed
      } catch (error) {
        if (error instanceof OwnerMethodError) throw error
        if (error instanceof Error && error.name === 'ProjectConflictError')
          throw new OwnerMethodError('PROJECT_EXISTS')
        throw new OwnerMethodError('INVALID_PARAMS')
      }
    },

    async projectDelete(context: OwnerMethodContext, input: { projectId?: unknown }) {
      const owner = requireOwner(context)
      if (typeof input.projectId !== 'string' || !input.projectId)
        throw new OwnerMethodError('INVALID_PARAMS')
      if (!(await dependencies.workspace.deleteProject(owner.ownerId, input.projectId)))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      return { deleted: true }
    },

    async codexStatus(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      const status = dependencies.codex.getStatus?.(owner.ownerId)
      return {
        status: status?.status ?? 'stopped',
        projectId: status?.projectId ?? null,
        activeCredentialId: status?.activeCredentialId ?? null,
        pendingCredentialId: status?.pendingCredentialId ?? null,
        restartRequired: status?.restartRequired ?? false,
        activeTurns: status?.activeTurns ?? 0,
        dangerousAccessConfirmed: status?.dangerousAccessConfirmed ?? false,
        error: status?.error ? 'CODEX_UNAVAILABLE' : null,
        currentCredentialId: await dependencies.workspace.getCurrentCredentialId(owner.ownerId),
      }
    },

    async capabilitiesList(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      try {
        return { models: (await dependencies.codex.modelCatalog?.(owner.ownerId)) ?? [] }
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async configurationContextWindowRead(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      const client = await readyClient(owner.ownerId)
      try {
        const result = await client.request('config/read', { includeLayers: false })
        const configured =
          isRecord(result) && isRecord(result.config)
            ? result.config.model_context_window
            : undefined
        return {
          modelContextWindow:
            typeof configured === 'number' && Number.isSafeInteger(configured) && configured > 0
              ? configured
              : 256_000,
          source:
            typeof configured === 'number' && Number.isSafeInteger(configured) && configured > 0
              ? 'configured'
              : 'default',
        }
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async configurationContextWindowWrite(
      context: OwnerMethodContext,
      input: { modelContextWindow?: unknown },
    ) {
      const owner = requireOwner(context)
      const value = input.modelContextWindow
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
        throw new OwnerMethodError('INVALID_PARAMS')
      const client = await readyClient(owner.ownerId)
      try {
        await client.request('config/value/write', {
          keyPath: 'model_context_window',
          value,
          mergeStrategy: 'replace',
        })
        return { modelContextWindow: value, source: 'configured' }
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async codexLifecycle(
      context: OwnerMethodContext,
      input: {
        operation?: unknown
        credentialId?: unknown
        confirmDangerousAccess?: unknown
      },
    ) {
      const owner = requireOwner(context)
      const operation = input.operation === 'restart' ? 'restart' : 'start'
      if (
        input.operation !== undefined &&
        input.operation !== 'start' &&
        input.operation !== 'restart'
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      if (options.requireDangerousAccessConfirmation && input.confirmDangerousAccess !== true)
        throw new OwnerMethodError('INVALID_PARAMS')
      if (input.credentialId !== undefined && !safeId(input.credentialId))
        throw new OwnerMethodError('INVALID_CREDENTIAL')
      const credentialId =
        input.credentialId ?? (await dependencies.workspace.getCurrentCredentialId(owner.ownerId))
      if (!credentialId) throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      if (!(await dependencies.workspace.getCredential(owner.ownerId, credentialId)))
        throw new OwnerMethodError('CREDENTIAL_NOT_FOUND')
      const method = operation === 'restart' ? dependencies.codex.restart : dependencies.codex.start
      if (!method) throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      try {
        await method.call(dependencies.codex, owner.ownerId, '', credentialId)
        dependencies.codex.markDangerousAccessConfirmed?.(owner.ownerId)
        await dependencies.workspace.setCurrentCredentialId(owner.ownerId, credentialId)
        return this.codexStatus(context)
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async skillsList(context: OwnerMethodContext, input: { projectId?: unknown }) {
      const owner = requireOwner(context)
      if (input.projectId !== undefined && !safeId(input.projectId))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const project = input.projectId
        ? await dependencies.workspace.getProject(owner.ownerId, input.projectId)
        : null
      if (input.projectId && !project) throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const cwd = project?.path ?? dependencies.workspace.getUserRoot(owner.ownerId)
      const client = await readyClient(owner.ownerId)
      try {
        const result = await client.request('skills/list', { cwds: [cwd] })
        return {
          data: skillsForCwd(result, cwd).map((skill) =>
            skillHandles.issue(owner.ownerId, cwd, skill),
          ),
        }
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async threadsList(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const projectId = input.projectId
      if (projectId !== undefined && !safeId(projectId))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const limitInput = input.limit === undefined ? 30 : Number(input.limit)
      if (!Number.isSafeInteger(limitInput) || limitInput < 1)
        throw new OwnerMethodError('INVALID_THREAD_QUERY')
      const result = await threadDomain.list({
        userId: owner.ownerId,
        ...(typeof projectId === 'string' ? { projectId } : {}),
        ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {}),
        limit: Math.min(limitInput, 100),
        archived: input.archived === true,
      })
      if (result.kind !== 'ok') throw mapThreadAccessFailure(result.kind)
      return result
    },

    async threadsCreate(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const projectId = input.projectId
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      const model = typeof input.model === 'string' ? input.model.trim() : ''
      const reasoningEffort = input.reasoningEffort
      const collaborationMode = input.collaborationMode
      const selectedHandles = parseSkillHandles(input.skillHandles)
      if (
        (projectId !== undefined && projectId !== null && !safeId(projectId)) ||
        !text ||
        text.length > MAX_INITIAL_MESSAGE_LENGTH ||
        !safeId(model) ||
        typeof reasoningEffort !== 'string' ||
        !safeId(reasoningEffort) ||
        (collaborationMode !== undefined &&
          collaborationMode !== 'default' &&
          collaborationMode !== 'plan') ||
        selectedHandles === null
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const project =
        typeof projectId === 'string'
          ? await dependencies.workspace.getProject(owner.ownerId, projectId)
          : null
      if (projectId && !project) throw new OwnerMethodError('PROJECT_NOT_FOUND')
      if (
        options.requireDangerousAccessConfirmation &&
        !dependencies.codex.getStatus?.(owner.ownerId)?.dangerousAccessConfirmed
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const client = await readyClient(owner.ownerId)
      const catalog = await dependencies.codex.modelCatalog?.(owner.ownerId)
      const selectedModel = catalog?.find((entry) => entry.id === model)
      if (
        catalog &&
        (!selectedModel ||
          !selectedModel.reasoningEfforts.some((entry) => entry.id === reasoningEffort))
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const cwd = project?.path ?? dependencies.workspace.getUserRoot(owner.ownerId)
      const selectedSkills = await resolveSelectedSkills(
        client,
        skillHandles,
        owner.ownerId,
        cwd,
        selectedHandles,
      )
      if (!selectedSkills) throw new OwnerMethodError('INVALID_TURN_REQUEST')
      try {
        const threadResult = await client.request('thread/start', {
          cwd,
          model,
          approvalPolicy: 'never',
          sandbox: 'danger-full-access',
        })
        const rawThread = isRecord(threadResult) ? threadResult.thread : undefined
        const threadId = isRecord(rawThread) ? rawThread.id : undefined
        if (!safeId(threadId)) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
        dependencies.codex.markThreadLoaded?.(owner.ownerId, threadId)
        const run = () =>
          client.request('turn/start', {
            threadId,
            input: turnInput(text, selectedSkills),
            effort: reasoningEffort,
            collaborationMode: {
              mode: collaborationMode ?? 'plan',
              settings: { model, reasoning_effort: reasoningEffort },
            },
          })
        const turnResult = await (dependencies.codex.enqueueTurn
          ? dependencies.codex.enqueueTurn(owner.ownerId, run, undefined, undefined, threadId)
          : run())
        const turn = isRecord(turnResult) ? turnResult.turn : undefined
        const turnId = isRecord(turn) ? turn.id : undefined
        if (!safeId(turnId)) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
        return { threadId, turnId, projectId: projectId ?? null }
      } catch (error) {
        if (error instanceof OwnerMethodError) throw error
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async threadsRead(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
      if (input.projectId !== undefined && input.projectId !== null && !safeId(input.projectId))
        throw new OwnerMethodError('INVALID_THREAD_QUERY')
      const threadId = input.threadId
      const history =
        (await dependencies.codex.events.threadHistory?.(owner.ownerId, threadId)) ?? []
      const eventCursor = makeEventCursor(
        owner.ownerId,
        history.at(-1)?.id ?? dependencies.codex.events.latestEventId(owner.ownerId, threadId),
      )
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId,
        projectId: typeof input.projectId === 'string' ? input.projectId : undefined,
        includeTurns: true,
        mode: 'read',
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
      const thread = projectThreadSnapshot(access.rawThread, access.cwd)
      if (!thread) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR', true)
      return {
        thread,
        eventCursor,
        historyEvents: history.map((event) => ({ id: event.id, event: event.message })),
      }
    },

    async threadsStatus(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
      const threadId = input.threadId
      const projectId = input.projectId
      if (projectId !== undefined && !safeId(projectId))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const rootScope = projectId === undefined
      const project = rootScope
        ? null
        : await dependencies.workspace.getProject(owner.ownerId, projectId)
      if (projectId !== undefined && !project) throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const client = await readyClient(owner.ownerId)
      const userRoot = dependencies.workspace.getUserRoot(owner.ownerId)
      let owned = await threadDomain.appearsInCwd(
        client,
        threadId,
        rootScope ? undefined : project!.path,
        false,
        rootScope ? userRoot : undefined,
      )
      if (owned && rootScope) {
        const projects = await dependencies.workspace.listProjectLocations(owner.ownerId)
        for (const candidate of projects) {
          // oxlint-disable-next-line no-await-in-loop
          if (await threadDomain.appearsInCwd(client, threadId, candidate.path)) {
            owned = false
            break
          }
        }
      }
      if (!owned) throw new OwnerMethodError('THREAD_NOT_FOUND')
      const runtime = dependencies.codex.events.threadRuntimeStatus?.(owner.ownerId, threadId) ?? {
        status: 'idle' as const,
        activeTurnId: null,
      }
      return {
        threadId,
        projectId: projectId ?? null,
        status: runtime.status,
        eventCursor: makeEventCursor(
          owner.ownerId,
          dependencies.codex.events.latestEventId(owner.ownerId, threadId),
        ),
        activeTurnId: runtime.activeTurnId,
      }
    },

    async threadsSend(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const threadId = input.threadId
      const projectId = input.projectId
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      const model = typeof input.model === 'string' ? input.model.trim() : ''
      const reasoningEffort = input.reasoningEffort
      const collaborationMode = input.collaborationMode
      const selectedHandles = parseSkillHandles(input.skillHandles)
      if (
        !safeId(threadId) ||
        (projectId !== undefined && projectId !== null && !safeId(projectId)) ||
        !text ||
        text.length > MAX_INITIAL_MESSAGE_LENGTH ||
        !safeId(model) ||
        typeof reasoningEffort !== 'string' ||
        !safeId(reasoningEffort) ||
        (collaborationMode !== undefined &&
          collaborationMode !== 'default' &&
          collaborationMode !== 'plan') ||
        selectedHandles === null
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      if (
        options.requireDangerousAccessConfirmation &&
        !dependencies.codex.getStatus?.(owner.ownerId)?.dangerousAccessConfirmed
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId,
        projectId: typeof projectId === 'string' ? projectId : undefined,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
      const catalog = await dependencies.codex.modelCatalog?.(owner.ownerId)
      const selectedModel = catalog?.find((entry) => entry.id === model)
      if (
        catalog &&
        (!selectedModel ||
          !selectedModel.reasoningEfforts.some((entry) => entry.id === reasoningEffort))
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const userRoot = dependencies.workspace.getUserRoot(owner.ownerId)
      await dependencies.codex.ensureThread?.(owner.ownerId, threadId)
      const selectedSkills = await resolveSelectedSkills(
        access.client,
        skillHandles,
        owner.ownerId,
        access.scope === 'project' ? access.cwd : userRoot,
        selectedHandles,
      )
      if (!selectedSkills) throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const run = () =>
        access.client.request('turn/start', {
          threadId,
          input: turnInput(text, selectedSkills),
          model,
          effort: reasoningEffort,
          collaborationMode: {
            mode: collaborationMode ?? 'plan',
            settings: { model, reasoning_effort: reasoningEffort },
          },
        })
      try {
        const result = await (dependencies.codex.enqueueTurn
          ? dependencies.codex.enqueueTurn(owner.ownerId, run, undefined, undefined, threadId)
          : run())
        const turn = isRecord(result) ? result.turn : undefined
        const turnId = isRecord(turn) ? turn.id : undefined
        if (!safeId(turnId)) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
        return { turnId }
      } catch (error) {
        if (error instanceof OwnerMethodError) throw error
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async threadsCancel(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.threadId) || !safeId(input.turnId))
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const threadId = input.threadId
      const turnId = input.turnId
      if (dependencies.codex.cancelQueuedTurn?.(owner.ownerId, turnId)) return { cancelled: true }
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
      try {
        const result = await access.client.request('turn/interrupt', { threadId, turnId })
        return { result }
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async threadsCompact(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId: input.threadId,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
      try {
        await access.client.request('thread/compact/start', { threadId: input.threadId })
        return { accepted: true }
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
    },

    async threadsArchive(context: OwnerMethodContext, input: Record<string, unknown>) {
      return threadMutation(context, input, 'thread/archive')
    },

    async threadsUnarchive(context: OwnerMethodContext, input: Record<string, unknown>) {
      return threadMutation(context, input, 'thread/unarchive', true)
    },

    async threadsDelete(context: OwnerMethodContext, input: Record<string, unknown>) {
      return threadMutation(context, input, 'thread/delete', true)
    },

    async threadsDeleteAll(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (input.archived !== true) throw new OwnerMethodError('INVALID_THREAD_QUERY')
      const client = await readyClient(owner.ownerId)
      const userRoot = dependencies.workspace.getUserRoot(owner.ownerId)
      let cursor: string | undefined
      try {
        do {
          // oxlint-disable-next-line no-await-in-loop
          const result = (await client.request('thread/list', {
            archived: true,
            ...(cursor ? { cursor } : {}),
            limit: 100,
            sortDirection: 'desc',
            sortKey: 'updated_at',
          })) as { data?: unknown; nextCursor?: unknown }
          for (const thread of Array.isArray(result.data) ? result.data : []) {
            const id = isRecord(thread) ? thread.id : undefined
            const cwd = isRecord(thread) ? thread.cwd : undefined
            if (safeId(id) && threadDomain.pathIsWithin(cwd, userRoot)) {
              // oxlint-disable-next-line no-await-in-loop
              await client.request('thread/delete', { threadId: id })
            }
          }
          cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined
        } while (cursor)
      } catch {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
      }
      return { deleted: true }
    },

    async userInputRespond(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const threadId = input.threadId
      const parsedRequestId =
        typeof input.requestId === 'string' || typeof input.requestId === 'number'
          ? parseRequestId(String(input.requestId))
          : null
      const answers = input.answers
      if (
        !safeId(threadId) ||
        (typeof parsedRequestId !== 'string' && typeof parsedRequestId !== 'number') ||
        !isRecord(answers) ||
        Object.values(answers).some(
          (value) =>
            !isRecord(value) ||
            !Array.isArray(value.answers) ||
            !value.answers.every((answer) => typeof answer === 'string'),
        ) ||
        !dependencies.codex.respondToServerRequest
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId: threadId as string,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
      const resolvedRequestId = (() => {
        try {
          return (
            dependencies.codex.respondToServerRequest!(owner.ownerId, threadId, parsedRequestId, {
              answers,
            }) ?? parsedRequestId
          )
        } catch {
          throw new OwnerMethodError('RESOURCE_NOT_FOUND')
        }
      })()
      await dependencies.codex.events.publish?.(owner.ownerId, {
        method: 'webcodex/userInput/answered',
        params: { threadId, requestId: resolvedRequestId, answers },
      })
      return { accepted: true }
    },

    async approvalsResolve(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const threadId = input.threadId
      const parsedRequestId =
        typeof input.requestId === 'string' || typeof input.requestId === 'number'
          ? parseRequestId(String(input.requestId))
          : null
      if (
        !safeId(threadId) ||
        (typeof parsedRequestId !== 'string' && typeof parsedRequestId !== 'number') ||
        !('decision' in input) ||
        !dependencies.codex.respondToServerRequest
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId: threadId as string,
        mode: 'mutation',
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
      try {
        dependencies.codex.respondToServerRequest(
          owner.ownerId,
          threadId,
          parsedRequestId,
          input.decision,
        )
        return { accepted: true }
      } catch {
        throw new OwnerMethodError('RESOURCE_NOT_FOUND')
      }
    },

    async eventsSubscribe(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const requestedSubscriptionId = input.subscriptionId
      if (requestedSubscriptionId !== undefined && !safeId(requestedSubscriptionId))
        throw new OwnerMethodError('SUBSCRIPTION_EXPIRED')
      const existing =
        typeof requestedSubscriptionId === 'string'
          ? subscriptions.get(requestedSubscriptionId)
          : undefined
      if (
        requestedSubscriptionId !== undefined &&
        (!existing ||
          existing.ownerId !== owner.ownerId ||
          existing.sessionId !== owner.sessionId ||
          existing.expiresAt <= Date.now())
      ) {
        if (existing?.expiresAt && existing.expiresAt <= Date.now())
          subscriptions.delete(String(requestedSubscriptionId))
        throw new OwnerMethodError('SUBSCRIPTION_EXPIRED')
      }
      const scope = existing?.scope ?? (input.scope === 'workspace' ? 'workspace' : 'thread')
      const threadId = input.threadId
      if (scope === 'thread' && !safeId(threadId))
        throw new OwnerMethodError('INVALID_EVENT_CURSOR')
      if (scope === 'thread') {
        const access = await threadDomain.access({
          userId: owner.ownerId,
          threadId: threadId as string,
          mode: 'read',
          includeTurns: false,
        })
        if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
      }
      const latestSequence = dependencies.codex.events.latestEventId(
        owner.ownerId,
        scope === 'thread' ? (threadId as string) : undefined,
      )
      const cursor = parseEventCursor(input.cursor)
      if (cursor === null) throw new OwnerMethodError('INVALID_EVENT_CURSOR')
      const requestedSequence = cursor?.sequence ?? latestSequence
      const expired = cursor
        ? await dependencies.codex.events.isCursorExpired?.(
            owner.ownerId,
            scope === 'thread' ? (threadId as string) : undefined,
            cursor.sequence,
          )
        : false
      const effectiveResetReason =
        cursor?.epoch !== undefined && cursor.epoch !== eventEpoch(owner.ownerId)
          ? 'epoch_changed'
          : cursor && (cursor.sequence > latestSequence || expired)
            ? 'cursor_gap'
            : undefined
      const subscriptionId = existing ? String(requestedSubscriptionId) : crypto.randomUUID()
      subscriptions.set(subscriptionId, {
        ownerId: owner.ownerId,
        sessionId: owner.sessionId,
        scope,
        ...(scope === 'thread' ? { threadId: threadId as string } : {}),
        expiresAt: Date.now() + SUBSCRIPTION_TTL_MS,
      })
      return {
        result: {
          subscriptionId,
          cursor: makeEventCursor(owner.ownerId, requestedSequence),
        },
        stream: {
          meta: {
            subscriptionId,
            scope,
            threadId: scope === 'thread' ? threadId : null,
            cursor: makeEventCursor(owner.ownerId, requestedSequence),
          },
          run: (emit: (event: unknown) => Promise<void>, signal: AbortSignal) =>
            new Promise<void>((resolve) => {
              if (effectiveResetReason) {
                void emit({
                  method: 'events.reset',
                  params: {
                    cursor: makeEventCursor(owner.ownerId, latestSequence),
                    reason: effectiveResetReason,
                  },
                }).finally(resolve)
                return
              }
              const subscribe = dependencies.codex.events.subscribeFrom
                ? dependencies.codex.events.subscribeFrom.bind(dependencies.codex.events)
                : async (
                    userId: string,
                    threadFilter: string | undefined,
                    afterId: number,
                    listener: (event: { id: number; message: Record<string, unknown> }) => void,
                  ) => dependencies.codex.events.subscribe(userId, threadFilter, afterId, listener)
              void subscribe(
                owner.ownerId,
                scope === 'thread' ? (threadId as string) : undefined,
                requestedSequence,
                (event) => {
                  if (signal.aborted) return
                  void emit({
                    cursor: makeEventCursor(owner.ownerId, event.id),
                    event: event.message,
                  })
                },
              )
                .then((unsubscribe) => {
                  signal.addEventListener(
                    'abort',
                    () => {
                      unsubscribe()
                      resolve()
                    },
                    { once: true },
                  )
                  if (signal.aborted) {
                    unsubscribe()
                    resolve()
                  }
                  return undefined
                })
                .catch(() => resolve())
            }),
        },
      }
    },

    async eventsResume(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.subscriptionId) || input.cursor === undefined)
        throw new OwnerMethodError('INVALID_EVENT_CURSOR')
      const subscription = subscriptions.get(input.subscriptionId as string)
      if (
        !subscription ||
        subscription.ownerId !== owner.ownerId ||
        subscription.sessionId !== owner.sessionId ||
        subscription.expiresAt <= Date.now()
      ) {
        subscriptions.delete(input.subscriptionId as string)
        throw new OwnerMethodError('SUBSCRIPTION_EXPIRED')
      }
      return this.eventsSubscribe(context, {
        scope: subscription.scope,
        ...(subscription.threadId ? { threadId: subscription.threadId } : {}),
        cursor: input.cursor,
        subscriptionId: input.subscriptionId,
      })
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

    async remoteTrustReset(context: OwnerMethodContext) {
      requireOwner(context)
      if (!dependencies.remote) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      try {
        await services.enrollmentInvalidate()
        const result = await dependencies.remote.resetRemoteTrust()
        await authDomain?.revokeAllRemoteSessions()
        return result
      } catch {
        throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      }
    },

    async remoteDevices(context: OwnerMethodContext) {
      requireOwner(context)
      if (!dependencies.remote) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      const devices = await dependencies.remote.listDevices()
      return devices.map(({ id, createdAt, lastSeenAt }) => ({ id, createdAt, lastSeenAt }))
    },

    async remoteDeviceRevoke(context: OwnerMethodContext, input: Record<string, unknown>) {
      requireOwner(context)
      if (!safeId(input.deviceId)) throw new OwnerMethodError('INVALID_PARAMS')
      if (!dependencies.remote) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      await services.enrollmentInvalidate()
      const revoked = await dependencies.remote.revokeDevice(input.deviceId)
      if (!revoked) throw new OwnerMethodError('DEVICE_NOT_FOUND')
      await authDomain?.markDeviceRevoked(input.deviceId)
      return { revoked: true }
    },

    async remoteDevicesRevokeAll(context: OwnerMethodContext) {
      requireOwner(context)
      if (!authDomain || !dependencies.remote)
        throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      await services.enrollmentInvalidate()
      const devices = await dependencies.remote.listDevices()
      for (const device of devices) await dependencies.remote.revokeDevice(device.id)
      await authDomain.revokeAllDevices()
      return { revoked: devices.length }
    },

    async ownerSecurityStatus(context: OwnerMethodContext) {
      requireOwner(context)
      const devices = dependencies.remote
        ? (await dependencies.remote.listDevices()).map(({ id, createdAt, lastSeenAt }) => ({
            id,
            createdAt,
            lastSeenAt,
          }))
        : []
      const remotePasskeyAvailable = authDomain ? await authDomain.hasPasskey('remote') : false
      const localPasskeyAvailable = authDomain ? await authDomain.hasPasskey('local') : false
      return {
        remotePasskeyAvailable,
        localPasskeyAvailable,
        initialized: true,
        devices,
      }
    },
  }

  return {
    ...services,
    localManagement: createLocalManagementServices(dependencies),
    async startupEnrollmentPayload() {
      return undefined
    },
  }

  function createLocalManagementServices(deps: OwnerApplicationServiceDependencies) {
    return {
      async authStatus() {
        return {
          initialized: true,
          remotePasskeyAvailable: authDomain ? await authDomain.hasPasskey('remote') : false,
          localPasskeyAvailable: authDomain ? await authDomain.hasPasskey('local') : false,
        }
      },
      async enrollmentIssue() {
        return issueEnrollmentInvitation('cli')
      },
      async enrollmentRecover() {
        if (!deps.remote || !authDomain || !deps.ownerId) throw new Error('REMOTE_UNAVAILABLE')
        await authDomain.revokeAllRemoteSessions()
        const reset = await deps.remote.resetRemoteTrust()
        enrollmentInvitations.invalidate()
        activeEnrollmentReference = undefined
        if (enrollmentTimer) clearTimeout(enrollmentTimer)
        enrollmentTimer = undefined
        await deps.remote.waitUntilConnected()
        return { ...(await issueEnrollmentInvitation('cli')), reset }
      },
      async revokeAllSessions() {
        if (!authDomain) return { revoked: 0 }
        return authDomain.revokeAllRemoteSessions()
      },
      async listDevices() {
        return deps.remote ? deps.remote.listDevices() : []
      },
      async revokeDevice(deviceId: string) {
        if (!safeId(deviceId)) throw new Error('INVALID_DEVICE_ID')
        if (!deps.remote || !(await deps.remote.revokeDevice(deviceId)))
          throw new Error('DEVICE_NOT_FOUND')
        await services.enrollmentInvalidate()
        await authDomain?.markDeviceRevoked(deviceId)
        return { revoked: true }
      },
      async revokeAllDevices() {
        if (!deps.remote) return { revoked: 0 }
        await services.enrollmentInvalidate()
        const devices = await deps.remote.listDevices()
        for (const device of devices) await deps.remote.revokeDevice(device.id)
        return authDomain ? authDomain.revokeAllDevices() : { revoked: devices.length }
      },
      async trustReset() {
        if (!deps.remote) throw new Error('REMOTE_UNAVAILABLE')
        await services.enrollmentInvalidate()
        const reset = await deps.remote.resetRemoteTrust()
        await authDomain?.revokeAllDevices()
        return reset
      },
    }
  }

  async function threadMutation(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
    method: string,
    archived = false,
  ) {
    const owner = requireOwner(context)
    if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
    const projectId = input.projectId
    if (projectId !== undefined && !safeId(projectId))
      throw new OwnerMethodError('PROJECT_NOT_FOUND')
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId: input.threadId,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      archived,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access.kind)
    try {
      await access.client.request(method, { threadId: input.threadId })
      return { accepted: true }
    } catch {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
    }
  }

  async function readyClient(ownerId: string) {
    if (!dependencies.codex.getReady) throw new OwnerMethodError('CODEX_START_REQUIRED', true)
    try {
      return await dependencies.codex.getReady(ownerId)
    } catch {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true)
    }
  }
}

function requireLocalOwner(context: OwnerMethodContext) {
  requireOwner(context)
  if (context.transport.kind !== 'local') throw new OwnerMethodError('LOCAL_TRANSPORT_REQUIRED')
}

function webauthnProfile(transport: OwnerTransport): keyof typeof WEBAUTHN_PROFILES | null {
  if (transport.kind === 'relay' && transport.e2eeVerified === true) return 'remote'
  if (transport.kind === 'local' && transport.origin === 'http://localhost:5173') return 'local'
  return null
}

function authBinding(context: OwnerMethodContext) {
  return {
    connectionId: context.connectionId,
    clientPublicKey: context.transport.clientPublicKey ?? 'local',
  }
}

function requireOwner(context: OwnerMethodContext): OwnerContext {
  if (!context.owner) throw new OwnerMethodError('UNAUTHORIZED')
  return context.owner
}
