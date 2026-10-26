import type { Auth } from '../auth.js'
import { createHash, randomUUID } from 'node:crypto'
import type { CodexBridge } from '../http/types.js'
import { projectNativeThread } from '../codex/native-protocol.js'
import { parseRequestId } from '../codex/request-id.js'
import { createThreadDomain } from '../threads/index.js'
import { SkillHandleStore, skillsForCwd, turnInput } from '../skills.js'
import { parseSkillHandles, resolveSelectedSkills } from './skill-selection.js'
import type { WorkspaceService } from '../workspace.js'
import type { OwnerConnector } from '../remote/connector.js'
import { OwnerMethodError } from './session-runtime.js'
import type { OwnerContext, OwnerMethodContext, OwnerTransport } from './session-runtime.js'

const MAX_INITIAL_MESSAGE_LENGTH = 256_000
const SUBSCRIPTION_TTL_MS = 10 * 60 * 1000

export type OwnerEventCursor = { epoch: string; sequence: number }

function eventEpoch(ownerId: string) {
  return createHash('sha256').update(`codex-web-owner-event-v1:${ownerId}`).digest('base64url')
}

function makeEventCursor(ownerId: string, sequence: number): OwnerEventCursor {
  return { epoch: eventEpoch(ownerId), sequence }
}

function parseEventCursor(value: unknown, ownerId: string): OwnerEventCursor | null | undefined {
  if (value === undefined) return undefined
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('epoch' in value) ||
    !('sequence' in value) ||
    Object.keys(value).some((key) => key !== 'epoch' && key !== 'sequence')
  )
    return null
  const cursor = value as Partial<OwnerEventCursor>
  if (
    cursor.epoch !== eventEpoch(ownerId) ||
    typeof cursor.sequence !== 'number' ||
    !Number.isSafeInteger(cursor.sequence) ||
    cursor.sequence < 0
  )
    return null
  return { epoch: cursor.epoch, sequence: cursor.sequence }
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

type SessionSnapshot = {
  user: {
    id: string
    email: string
    name: string
    twoFactorEnabled?: boolean
  }
  session: {
    id: string
    expiresAt: Date | string
  }
}

export type OwnerApplicationServiceDependencies = {
  auth: Auth
  workspace: WorkspaceService & { hasOwner?: () => Promise<boolean> }
  codex: CodexBridge
  remote?: OwnerConnector
}

export type OwnerApplicationServiceOptions = {
  trustedOrigins: readonly string[]
  requireDangerousAccessConfirmation?: boolean
  remoteRelayUrl?: string
}

export type OwnerSessionResult = {
  token: string
  session: {
    user: { id: string; email: string; name: string }
    expiresAt: string
  }
  admission: { ownerId: string; sessionId: string; sessionToken: string }
}

type ResolvedOwnerSession = { snapshot: SessionSnapshot; token: string }

type OwnerSessionOpenResult =
  | OwnerSessionResult
  | {
      pendingTwoFactor: { challengeId: string; expiresAt: string }
    }

type PendingTwoFactor = {
  cookie: string
  expiresAt: number
  bootstrapId?: string
  clientPublicKey?: string
}

export type OwnerApplicationServices = ReturnType<typeof createOwnerApplicationServices>

export function createOwnerApplicationServices(
  dependencies: OwnerApplicationServiceDependencies,
  options: OwnerApplicationServiceOptions,
) {
  let bootstrapQueue: Promise<void> = Promise.resolve()
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
  const pendingTwoFactor = new Map<string, PendingTwoFactor>()

  return {
    async ownerStatus(context: OwnerMethodContext) {
      const ownerExists = (await dependencies.workspace.hasOwner?.()) ?? false
      return {
        ownerExists,
        authenticated: context.owner !== null,
        ...(context.owner ? { ownerId: context.owner.ownerId } : {}),
      }
    },

    async bootstrapCreate(
      context: OwnerMethodContext,
      input: { name?: unknown; email?: unknown; password?: unknown },
    ): Promise<OwnerSessionResult> {
      assertLocalBootstrap(context.transport, options.trustedOrigins)
      if (
        typeof input.name !== 'string' ||
        typeof input.email !== 'string' ||
        typeof input.password !== 'string'
      )
        throw new OwnerMethodError('INVALID_PARAMS')

      return withBootstrapLock(async () => {
        if ((await dependencies.workspace.hasOwner?.()) ?? false)
          throw new OwnerMethodError('OWNER_ALREADY_EXISTS')
        try {
          const response = await dependencies.auth.api.signUpEmail({
            body: {
              name: input.name as string,
              email: input.email as string,
              password: input.password as string,
            },
            asResponse: true,
          })
          return await sessionResult(dependencies.auth, response)
        } catch (error) {
          if (error instanceof OwnerMethodError) throw error
          throw new OwnerMethodError('AUTH_FAILURE')
        }
      })
    },

    async bootstrapConsume(context: OwnerMethodContext, input: { token?: unknown }) {
      if (
        context.transport.kind !== 'relay' ||
        !dependencies.remote ||
        typeof input.token !== 'string'
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      return dependencies.remote.consumeBootstrapCapability(input.token)
    },

    async sessionOpen(
      input: { email?: unknown; password?: unknown },
      context?: OwnerMethodContext,
    ): Promise<OwnerSessionOpenResult> {
      if (typeof input.email !== 'string' || typeof input.password !== 'string')
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const response = await dependencies.auth.api.signInEmail({
          body: { email: input.email, password: input.password },
          asResponse: true,
        })
        if (response.ok) {
          const token = response.headers.get('set-auth-token')
          if (token) return await sessionResult(dependencies.auth, response)
          const body = await response
            .clone()
            .json()
            .catch(() => null)
          const cookie = authCookie(response.headers)
          if (
            isRecord(body) &&
            body.twoFactorRedirect === true &&
            cookie &&
            context?.transport.kind === 'relay'
          ) {
            const challengeId = randomUUID()
            const expiresAt = Date.now() + 10 * 60 * 1_000
            pendingTwoFactor.set(challengeId, {
              cookie,
              expiresAt,
              bootstrapId: context.transport.bootstrapId,
              clientPublicKey: context.transport.clientPublicKey,
            })
            return {
              pendingTwoFactor: {
                challengeId,
                expiresAt: new Date(expiresAt).toISOString(),
              },
            }
          }
        }
        throw new OwnerMethodError('AUTH_FAILURE')
      } catch (error) {
        if (error instanceof OwnerMethodError) throw error
        throw new OwnerMethodError('AUTH_FAILURE')
      }
    },

    async remoteDeviceTrust(
      context: OwnerMethodContext,
      input: { publicKey?: unknown; challenge?: unknown },
    ) {
      const owner = requireOwner(context)
      if (
        context.transport.kind !== 'relay' ||
        !context.transport.e2eeVerified ||
        !context.transport.pairedDeviceId?.startsWith('bootstrap:')
      )
        throw new OwnerMethodError('UNAUTHORIZED')
      const provisional = context.transport as OwnerTransport & {
        bootstrapId?: string
        clientPublicKey?: string
        promote?: (deviceId: string, clientToken: string) => void
      }
      if (
        typeof input.publicKey !== 'string' ||
        input.publicKey !== provisional.clientPublicKey ||
        !provisional.bootstrapId ||
        !provisional.promote ||
        !dependencies.remote
      )
        throw new OwnerMethodError('INVALID_PARAMS')
      if (!context.owner) throw new OwnerMethodError('UNAUTHORIZED')
      if (typeof input.challenge !== 'string') {
        return dependencies.remote.trust.issueTrustChallenge(
          context.owner.sessionId,
          input.publicKey,
        )
      }
      if (
        !dependencies.remote.trust.consumeTrustChallenge(
          input.challenge,
          context.owner.sessionId,
          input.publicKey,
        )
      )
        throw new OwnerMethodError('UNAUTHORIZED')
      const promoted = await dependencies.remote.promoteBootstrap(
        provisional.bootstrapId,
        input.publicKey,
      )
      if (!promoted) throw new OwnerMethodError('RESOURCE_NOT_FOUND')
      return {
        deviceId: promoted.deviceId,
        clientToken: promoted.clientToken,
        ownerId: owner.ownerId,
      }
    },

    async resumeSession(token: string, transport: OwnerTransport) {
      if (
        transport.kind === 'relay' &&
        (!transport.pairedDeviceId || transport.e2eeVerified !== true)
      )
        return null
      if (!token || token.length > 4096) return null
      const resolved = await sessionFromToken(dependencies.auth, token)
      if (!resolved) return null
      return {
        ownerId: resolved.snapshot.user.id,
        sessionId: resolved.snapshot.session.id,
        sessionToken: resolved.token,
      }
    },

    async sessionClose(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      if (!owner.sessionToken) throw new OwnerMethodError('UNAUTHORIZED')
      try {
        await dependencies.auth.api.signOut({
          headers: bearerHeaders(owner.sessionToken),
        })
      } catch {
        throw new OwnerMethodError('AUTH_FAILURE')
      }
      return { closed: true }
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
      const thread = projectNativeThread(access.rawThread, access.cwd)
      if (!thread) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR', true)
      return {
        thread,
        eventCursor,
        historyEvents: history.filter((event) => isReplayableThreadEvent(event.message)),
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
      const parsedRequestId = parseRequestId(String(input.requestId ?? ''))
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
      const parsedRequestId = parseRequestId(String(input.requestId ?? ''))
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
      const cursor = parseEventCursor(input.cursor, owner.ownerId)
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
        cursor && (cursor.sequence > latestSequence || expired) ? 'cursor_gap' : undefined
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
                    ...event.message,
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

    async remotePairingOffer(context: OwnerMethodContext, input: Record<string, unknown>) {
      requireLocalOwner(context)
      if (!dependencies.remote) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      const relayUrl = input.relayUrl
      if (relayUrl !== undefined && typeof relayUrl !== 'string')
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        return await dependencies.remote.createPairingOffer(relayUrl as string | undefined)
      } catch (error) {
        if (error instanceof Error && error.message === 'CODEX_REMOTE_RELAY_URL_REQUIRED')
          throw new OwnerMethodError('REMOTE_RELAY_REQUIRED')
        throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      }
    },

    async remoteTrustReset(context: OwnerMethodContext) {
      requireLocalOwner(context)
      if (!dependencies.remote) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      try {
        return await dependencies.remote.resetRemoteTrust()
      } catch {
        throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      }
    },

    async remoteDevices(context: OwnerMethodContext) {
      requireLocalOwner(context)
      if (!dependencies.remote) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      return dependencies.remote.listDevices()
    },

    async remoteDeviceRevoke(context: OwnerMethodContext, input: Record<string, unknown>) {
      requireLocalOwner(context)
      if (!safeId(input.deviceId)) throw new OwnerMethodError('INVALID_PARAMS')
      if (!dependencies.remote) throw new OwnerMethodError('REMOTE_UNAVAILABLE', true)
      const revoked = await dependencies.remote.revokeDevice(input.deviceId)
      if (!revoked) throw new OwnerMethodError('DEVICE_NOT_FOUND')
      return { revoked: true }
    },

    async ownerSecurityStatus(context: OwnerMethodContext) {
      requireLocalOwner(context)
      const owner = requireOwner(context)
      const devices = dependencies.remote ? await dependencies.remote.listDevices() : []
      let totpEnabled = false
      if (owner.sessionToken) {
        const session = await sessionFromToken(dependencies.auth, owner.sessionToken)
        totpEnabled = Boolean(session?.snapshot.user.twoFactorEnabled)
      }
      const bindingRequests = dependencies.remote
        ? await dependencies.remote.listPendingBindings()
        : []
      let recoveryCodesAvailable = false
      if (owner.sessionToken && typeof dependencies.auth.api.viewBackupCodes === 'function') {
        try {
          const codes = await dependencies.auth.api.viewBackupCodes({
            body: { userId: owner.ownerId },
          })
          recoveryCodesAvailable =
            isRecord(codes) && Array.isArray(codes.backupCodes) && codes.backupCodes.length > 0
        } catch {
          recoveryCodesAvailable = false
        }
      }
      return {
        totpEnabled,
        recoveryCodesAvailable,
        bindingRequests,
        devices,
      }
    },

    async ownerTotpEnable(context: OwnerMethodContext, input: Record<string, unknown>) {
      requireLocalOwner(context)
      const owner = requireOwner(context)
      if (typeof input.password !== 'string') throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const enable = (
          dependencies.auth.api as unknown as {
            enableTwoFactor: (args: unknown) => Promise<unknown>
          }
        ).enableTwoFactor
        const result = await enable({
          body: { password: input.password, method: 'totp', issuer: 'Codex Web' },
          headers: bearerHeaders(owner.sessionToken!),
        })
        if (!isRecord(result)) throw new OwnerMethodError('AUTH_FAILURE')
        return {
          ...(typeof result.totpURI === 'string' ? { totpURI: result.totpURI } : {}),
          requiresVerification: true,
        }
      } catch {
        throw new OwnerMethodError('AUTH_FAILURE')
      }
    },

    async ownerTotpVerify(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (typeof input.code !== 'string' || context.transport.kind !== 'local')
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const verify = (
          dependencies.auth.api as unknown as {
            verifyTOTP: (args: unknown) => Promise<unknown>
          }
        ).verifyTOTP
        const result = await verify({
          body: { code: input.code },
          headers: bearerHeaders(owner.sessionToken!),
        })
        if (!isRecord(result)) throw new OwnerMethodError('AUTH_FAILURE')
        return {
          verified: true,
          recoveryCodes: await generateRecoveryCodes(dependencies.auth, owner),
        }
      } catch {
        throw new OwnerMethodError('AUTH_FAILURE')
      }
    },

    async ownerRecoveryGenerate(context: OwnerMethodContext, input: Record<string, unknown>) {
      requireLocalOwner(context)
      const owner = requireOwner(context)
      return generateRecoveryCodes(dependencies.auth, owner, input.password)
    },

    async ownerRecoveryVerify(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (context.transport.kind !== 'local' || typeof input.code !== 'string')
        throw new OwnerMethodError('INVALID_PARAMS')
      try {
        const verify = (
          dependencies.auth.api as unknown as {
            verifyBackupCode: (args: unknown) => Promise<unknown>
          }
        ).verifyBackupCode
        await verify({
          body: { code: input.code },
          headers: bearerHeaders(owner.sessionToken!),
        })
        return { verified: true }
      } catch {
        throw new OwnerMethodError('AUTH_FAILURE')
      }
    },

    async remoteDeviceBindingStatus(context: OwnerMethodContext) {
      if (context.transport.kind !== 'relay' || !context.transport.bootstrapId)
        throw new OwnerMethodError('UNAUTHORIZED')
      return {
        status: 'pending',
        requestId: context.transport.bootstrapId,
        expiresAt: new Date(
          (await dependencies.remote?.bootstrap.capability(context.transport.bootstrapId))
            ?.expiresAt ?? 0,
        ).toISOString(),
      }
    },

    async remoteDeviceBindingVerifyTotp(
      context: OwnerMethodContext,
      input: Record<string, unknown>,
    ) {
      if (context.transport.kind !== 'relay' || typeof input.code !== 'string')
        throw new OwnerMethodError('INVALID_PARAMS')
      const challengeId = typeof input.challengeId === 'string' ? input.challengeId : null
      const pending = challengeId ? pendingTwoFactor.get(challengeId) : undefined
      if (
        !pending ||
        pending.expiresAt <= Date.now() ||
        pending.bootstrapId !== context.transport.bootstrapId ||
        pending.clientPublicKey !== context.transport.clientPublicKey
      ) {
        if (challengeId) pendingTwoFactor.delete(challengeId)
        throw new OwnerMethodError('AUTH_FAILURE')
      }
      try {
        const verify = (
          dependencies.auth.api as unknown as {
            verifyTOTP: (args: unknown) => Promise<unknown>
          }
        ).verifyTOTP
        const verified = await verify({
          body: { code: input.code },
          headers: new Headers({ cookie: pending.cookie }),
        })
        const token =
          isRecord(verified) && typeof verified.token === 'string' ? verified.token : null
        if (!token) throw new Error('Missing verified session')
        const resolved = await sessionFromToken(dependencies.auth, token)
        if (!resolved) throw new Error('Missing verified session')
        await context.authenticate({
          ownerId: resolved.snapshot.user.id,
          sessionId: resolved.snapshot.session.id,
          sessionToken: resolved.token,
        })
        if (challengeId) pendingTwoFactor.delete(challengeId)
        return { verified: true, requestId: context.transport.bootstrapId }
      } catch {
        throw new OwnerMethodError('AUTH_FAILURE')
      }
    },

    async remoteDeviceBindingVerifyRecoveryCode(
      context: OwnerMethodContext,
      input: Record<string, unknown>,
    ) {
      if (context.transport.kind !== 'relay' || typeof input.code !== 'string')
        throw new OwnerMethodError('INVALID_PARAMS')
      const challengeId = typeof input.challengeId === 'string' ? input.challengeId : null
      const pending = challengeId ? pendingTwoFactor.get(challengeId) : undefined
      if (
        !pending ||
        pending.expiresAt <= Date.now() ||
        pending.bootstrapId !== context.transport.bootstrapId ||
        pending.clientPublicKey !== context.transport.clientPublicKey
      ) {
        if (challengeId) pendingTwoFactor.delete(challengeId)
        throw new OwnerMethodError('AUTH_FAILURE')
      }
      try {
        const verify = (
          dependencies.auth.api as unknown as {
            verifyBackupCode: (args: unknown) => Promise<unknown>
          }
        ).verifyBackupCode
        const verified = await verify({
          body: { code: input.code },
          headers: new Headers({ cookie: pending.cookie }),
        })
        const token =
          isRecord(verified) && typeof verified.token === 'string' ? verified.token : null
        if (!token) throw new Error('Missing verified session')
        const resolved = await sessionFromToken(dependencies.auth, token)
        if (!resolved) throw new Error('Missing verified session')
        await context.authenticate({
          ownerId: resolved.snapshot.user.id,
          sessionId: resolved.snapshot.session.id,
          sessionToken: resolved.token,
        })
        if (challengeId) pendingTwoFactor.delete(challengeId)
        return { verified: true, requestId: context.transport.bootstrapId }
      } catch {
        throw new OwnerMethodError('AUTH_FAILURE')
      }
    },

    async remoteDeviceBindingApprove(context: OwnerMethodContext, input: Record<string, unknown>) {
      requireLocalOwner(context)
      if (!dependencies.remote || !safeId(input.requestId))
        throw new OwnerMethodError('INVALID_PARAMS')
      const result = await dependencies.remote.approveBootstrap(input.requestId)
      if (!result) throw new OwnerMethodError('RESOURCE_NOT_FOUND')
      return { approved: true, deviceId: result.deviceId }
    },

    async remoteDeviceBindingReject(context: OwnerMethodContext, input: Record<string, unknown>) {
      requireLocalOwner(context)
      if (!dependencies.remote || !safeId(input.requestId))
        throw new OwnerMethodError('INVALID_PARAMS')
      if (!(await dependencies.remote.rejectBootstrap(input.requestId)))
        throw new OwnerMethodError('RESOURCE_NOT_FOUND')
      return { rejected: true }
    },
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

  async function withBootstrapLock<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = bootstrapQueue
    bootstrapQueue = next
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function requireLocalOwner(context: OwnerMethodContext) {
  requireOwner(context)
  if (context.transport.kind !== 'local') throw new OwnerMethodError('LOCAL_TRANSPORT_REQUIRED')
}

function isReplayableThreadEvent(message: { method: string; params?: Record<string, unknown> }) {
  if (
    message.method === 'thread/settings/updated' ||
    message.method === 'thread/tokenUsage/updated' ||
    message.method === 'item/tool/requestUserInput' ||
    message.method === 'webcodex/userInput/answered' ||
    message.method === 'serverRequest/resolved' ||
    message.method === 'item/commandExecution/outputDelta'
  )
    return true
  if (message.method !== 'item/started' && message.method !== 'item/completed') return false
  const item = message.params?.item
  return isRecord(item) && item.type === 'commandExecution'
}

function assertLocalBootstrap(transport: OwnerTransport, trustedOrigins: readonly string[]) {
  if (transport.kind !== 'local' || !transport.origin || !trustedOrigins.includes(transport.origin))
    throw new OwnerMethodError('LOCAL_TRANSPORT_REQUIRED')
}

function requireOwner(context: OwnerMethodContext): OwnerContext {
  if (!context.owner) throw new OwnerMethodError('UNAUTHORIZED')
  return context.owner
}

async function sessionResult(auth: Auth, response: Response): Promise<OwnerSessionResult> {
  if (!response.ok) throw new OwnerMethodError('AUTH_FAILURE')
  const token = response.headers.get('set-auth-token')
  if (!token) throw new OwnerMethodError('AUTH_FAILURE')
  const resolved = await sessionFromToken(auth, token)
  if (!resolved) throw new OwnerMethodError('AUTH_FAILURE')
  const session = resolved.snapshot
  return {
    token: resolved.token,
    session: {
      user: session.user,
      expiresAt: new Date(session.session.expiresAt).toISOString(),
    },
    admission: {
      ownerId: session.user.id,
      sessionId: session.session.id,
      sessionToken: resolved.token,
    },
  }
}

async function sessionFromToken(auth: Auth, token: string): Promise<ResolvedOwnerSession | null> {
  const response = await auth.api.getSession({ headers: bearerHeaders(token), asResponse: true })
  let value: SessionSnapshot
  let resolvedToken = token
  if (response instanceof Response) {
    if (!response.ok) return null
    try {
      value = (await response.json()) as SessionSnapshot
    } catch {
      return null
    }
    resolvedToken = response.headers.get('set-auth-token') ?? token
  } else {
    if (!response) return null
    value = response as unknown as SessionSnapshot
  }
  if (!value.user?.id || !value.session?.id || !value.session?.expiresAt) return null
  return {
    snapshot: {
      user: {
        id: value.user.id,
        email: value.user.email,
        name: value.user.name,
        ...(value.user.twoFactorEnabled === undefined
          ? {}
          : { twoFactorEnabled: Boolean(value.user.twoFactorEnabled) }),
      },
      session: {
        id: value.session.id,
        expiresAt: value.session.expiresAt,
      },
    },
    token: resolvedToken,
  }
}

function bearerHeaders(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` })
}

function authCookie(headers: Headers): string | null {
  const value =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()[0]
      : headers.get('set-cookie')?.split(',')[0]
  if (!value) return null
  const separator = value.indexOf(';')
  return separator === -1 ? value : value.slice(0, separator)
}

async function generateRecoveryCodes(auth: Auth, owner: OwnerContext, password?: unknown) {
  if (password !== undefined && typeof password !== 'string')
    throw new OwnerMethodError('INVALID_PARAMS')
  try {
    const generate = (
      auth.api as unknown as {
        generateBackupCodes: (args: unknown) => Promise<unknown>
      }
    ).generateBackupCodes
    const result = await generate({
      body: password === undefined ? {} : { password },
      headers: bearerHeaders(owner.sessionToken!),
    })
    if (
      !isRecord(result) ||
      !Array.isArray(result.backupCodes) ||
      !result.backupCodes.every((code) => typeof code === 'string')
    )
      throw new Error('Invalid recovery code response')
    return { recoveryCodes: result.backupCodes }
  } catch {
    throw new OwnerMethodError('AUTH_FAILURE')
  }
}
