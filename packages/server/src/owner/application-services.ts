import { createHash, randomUUID } from 'node:crypto'
import type { CodexBridge } from '../http/types.js'
import { applyChange, createConversationState, type Interaction } from '@codex-web/conversation'
import { adaptCodexSnapshot } from '../codex/conversation-adapter.js'
import {
  isConversationChange,
  parseOwnerEventCursor,
  type OwnerEventCursor,
} from '@codex-web/protocol/owner'
import { createThreadDomain } from '../threads/index.js'
import { summarizeSkill, skillsForCwd, turnInput } from '../skills.js'
import { parseSkills, resolveSelectedSkills } from './skill-selection.js'
import type { WorkspaceService } from '../workspace.js'
import type { OwnerConnector } from '../remote/connector.js'
import { createDeviceManagement } from './device-management.js'
import { OwnerMethodError } from './errors.js'
import type { OwnerContext, OwnerMethodContext, OwnerTransport } from './session-runtime.js'
import { createOwnerAuthDomain } from './auth-domain.js'
import { AuthDomainError } from './errors.js'
import type { Database } from '../database.js'
import { CodexRpcRequestError } from '../codex/rpc-client.js'
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

function mapThreadAccessFailure(result: { kind: string; error?: unknown }): OwnerMethodError {
  switch (result.kind) {
    case 'project_not_found':
      return new OwnerMethodError('PROJECT_NOT_FOUND')
    case 'codex_start_required':
      return new OwnerMethodError('CODEX_START_REQUIRED', true)
    case 'invalid_projection':
      return new OwnerMethodError('CODEX_PROTOCOL_ERROR', true)
    case 'not_found':
      return new OwnerMethodError('THREAD_NOT_FOUND')
    default:
      return new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: result.error })
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
    dependencies.database && dependencies.ownerId && options.appOrigin && options.rpId
      ? createOwnerAuthDomain(
          dependencies.database,
          dependencies.ownerId,
          () => Date.now(),
          async () =>
            dependencies.remote ? (await dependencies.remote.trust.identity()).trustEpoch : 0,
          { origin: options.appOrigin, rpId: options.rpId },
        )
      : undefined
  const devices = createDeviceManagement(
    dependencies.remote,
    authDomain,
    dependencies.ownerId,
    options.appOrigin ?? '',
  )
  const threadDomain = createThreadDomain({
    workspace: dependencies.workspace,
    codex: dependencies.codex,
  })
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
      } catch (error) {
        throw new OwnerMethodError('INVALID_CREDENTIAL', false, { cause: error })
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
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
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
        throw new OwnerMethodError('INVALID_PARAMS', false, { cause: error })
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
        throw new OwnerMethodError('INVALID_PARAMS', false, { cause: error })
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
        error: status?.error ?? null,
        currentCredentialId: await dependencies.workspace.getCurrentCredentialId(owner.ownerId),
      }
    },

    async capabilitiesList(context: OwnerMethodContext) {
      const owner = requireOwner(context)
      try {
        return { models: (await dependencies.codex.modelCatalog?.(owner.ownerId)) ?? [] }
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
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
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
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
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async codexLifecycle(
      context: OwnerMethodContext,
      input: {
        operation?: unknown
        credentialId?: unknown
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
        await dependencies.workspace.setCurrentCredentialId(owner.ownerId, credentialId)
        return this.codexStatus(context)
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async skillsList(context: OwnerMethodContext, input: { projectId?: unknown }) {
      const owner = requireOwner(context)
      if (input.projectId != null && !safeId(input.projectId))
        throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const project = input.projectId
        ? await dependencies.workspace.getProject(owner.ownerId, input.projectId)
        : null
      if (input.projectId && !project) throw new OwnerMethodError('PROJECT_NOT_FOUND')
      const cwd = project?.path ?? dependencies.workspace.getUserRoot(owner.ownerId)
      const client = await readyClient(owner.ownerId)
      try {
        const result = await client.request('skills/list', { cwds: [cwd] })
        return skillsForCwd(result, cwd).map(summarizeSkill)
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async threadsList(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const projectId = input.projectId
      if (projectId !== undefined && projectId !== null && !safeId(projectId))
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
      if (result.kind !== 'ok') throw mapThreadAccessFailure(result)
      return result
    },

    async threadsCreate(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const projectId = input.projectId
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      const model = typeof input.model === 'string' ? input.model.trim() : ''
      const reasoningEffort = input.reasoningEffort
      const collaborationMode = input.collaborationMode
      const selection = parseSkills(input.skills)
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
        selection === null
      )
        throw new OwnerMethodError('INVALID_TURN_REQUEST')
      const project =
        typeof projectId === 'string'
          ? await dependencies.workspace.getProject(owner.ownerId, projectId)
          : null
      if (projectId && !project) throw new OwnerMethodError('PROJECT_NOT_FOUND')
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
      const selectedSkills = await resolveSelectedSkills(client, cwd, selection)
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
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
    },

    async threadsRead(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
      if (input.projectId !== undefined && input.projectId !== null && !safeId(input.projectId))
        throw new OwnerMethodError('INVALID_THREAD_QUERY')
      const threadId = input.threadId
      const events = dependencies.codex.events
      let historyError: unknown
      const readHistory = () =>
        events.captureThreadSnapshot?.(owner.ownerId, threadId).catch((error: unknown) => {
          historyError = error
          return null
        }) ?? Promise.resolve(null)
      let historyAtResponse: ReturnType<typeof readHistory> | undefined
      const access = await threadDomain.access({
        userId: owner.ownerId,
        threadId,
        projectId: typeof input.projectId === 'string' ? input.projectId : undefined,
        includeTurns: true,
        mode: 'read',
        onReadResponse: () => {
          historyAtResponse = readHistory()
        },
      })
      if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
      const cut = await (historyAtResponse ?? readHistory())
      if (!cut) throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: historyError })
      const { history, sequence } = cut
      const base = adaptCodexSnapshot(access.rawThread, sequence)
      if (!base || base.id !== threadId) throw new OwnerMethodError('CODEX_PROTOCOL_ERROR', true)
      const snapshotMessages = new Set(
        Object.values(base.messages)
          .filter(
            (message) =>
              message.status !== 'inProgress' ||
              message.parts.some((part) => part.type !== 'text' || part.text.length > 0),
          )
          .map((message) => message.id),
      )
      let state = createConversationState(base)
      for (const { message } of history) {
        if (message.type !== 'conversation.change') continue
        const change = message.payload.change
        if (!isConversationChange(change)) continue
        switch (change.type) {
          case 'message.upserted':
            if (snapshotMessages.has(change.message.id)) continue
            if (base.turns[change.message.turnId]?.status !== 'inProgress') continue
            break
          case 'message.partAdded':
          case 'message.textDelta':
          case 'message.statusChanged':
            if (!Object.hasOwn(state.messages, change.messageId)) continue
            if (snapshotMessages.has(change.messageId)) continue
            break
          case 'activity.upserted':
            if (Object.hasOwn(base.activities, change.activity.id)) continue
            if (base.turns[change.activity.turnId]?.status !== 'inProgress') continue
            break
          case 'activity.outputDelta':
          case 'activity.statusChanged':
            if (!Object.hasOwn(state.activities, change.activityId)) continue
            if (Object.hasOwn(base.activities, change.activityId)) continue
            break
          case 'turn.planUpdated':
            if (!Object.hasOwn(base.turns, change.turnId)) continue
            if (base.turns[change.turnId]?.plan !== undefined) continue
            break
          case 'turn.diffUpdated':
            if (!Object.hasOwn(base.turns, change.turnId)) continue
            if (base.turns[change.turnId]?.diff !== undefined) continue
            break
          case 'interaction.opened':
          case 'interaction.resolved':
          case 'interaction.cancelled':
            break
          default:
            continue
        }
        state = applyChange(state, change)
      }
      const { seenSourceEvents: _, ...domainSnapshot } = state
      return { snapshot: domainSnapshot, watermark: makeEventCursor(owner.ownerId, sequence) }
    },

    async conversationCommand(context: OwnerMethodContext, input: Record<string, unknown>) {
      const owner = requireOwner(context)
      const threadId = input.conversationId
      if (!safeId(threadId)) throw new OwnerMethodError('INVALID_PARAMS')

      switch (input.type) {
        case 'turn.start': {
          const part: unknown =
            Array.isArray(input.input) && input.input.length === 1 ? input.input[0] : undefined
          if (
            !isRecord(part) ||
            part.type !== 'text' ||
            !safeId(part.id) ||
            typeof part.text !== 'string'
          )
            throw new OwnerMethodError('INVALID_TURN_REQUEST')
          return startConversationTurn(context, {
            threadId,
            text: part.text,
            projectId: input.projectId,
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            collaborationMode: input.collaborationMode,
            skills: input.skills,
          })
        }
        case 'turn.steer':
          return steerConversationTurn(context, { ...input, threadId })
        case 'turn.cancel':
          return cancelConversationTurn(context, { threadId, turnId: input.turnId })
        case 'conversation.compact':
          return compactConversation(context, { threadId })
        case 'conversation.archive':
          return services.threadsArchive(context, { threadId, projectId: input.projectId })
        case 'interaction.respond': {
          const { interactionId, outcome } = input
          if (!safeId(interactionId) || !isRecord(outcome))
            throw new OwnerMethodError('INVALID_PARAMS')
          const access = await threadDomain.access({
            userId: owner.ownerId,
            threadId,
            mode: 'mutation',
          })
          if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
          const history = await dependencies.codex.events.threadHistory?.(owner.ownerId, threadId)
          let interaction: Interaction | undefined
          for (const { message } of history ?? []) {
            if (message.type !== 'conversation.change' || message.threadId !== threadId) continue
            const change = message.payload.change
            if (!isConversationChange(change)) continue
            if (change.type === 'interaction.opened' && change.interaction.id === interactionId)
              interaction ??= change.interaction
            else if (
              (change.type === 'interaction.resolved' || change.type === 'interaction.cancelled') &&
              change.interactionId === interactionId
            ) {
              interaction = undefined
              break
            }
          }
          if (interaction?.status !== 'pending') throw new OwnerMethodError('RESOURCE_NOT_FOUND')
          const requestId = interaction.id
          if (
            interaction.kind === 'userInput' &&
            outcome.kind === 'answers' &&
            isRecord(outcome.answers)
          ) {
            const entries = Object.entries(outcome.answers)
            if (
              !entries.every(
                ([, answers]) =>
                  Array.isArray(answers) && answers.every((answer) => typeof answer === 'string'),
              )
            )
              throw new OwnerMethodError('INVALID_PARAMS')
            return replyToInteraction(owner.ownerId, threadId, requestId, {
              answers: Object.fromEntries(entries.map(([id, answers]) => [id, { answers }])),
            })
          }
          const decision =
            outcome.kind === 'approved'
              ? 'accept'
              : outcome.kind === 'rejected'
                ? 'decline'
                : outcome.kind === 'dismissed'
                  ? 'cancel'
                  : outcome.kind === 'submitted'
                    ? outcome.value
                    : undefined
          if (
            interaction.kind !== 'approval' ||
            (decision !== 'accept' &&
              decision !== 'acceptForSession' &&
              decision !== 'decline' &&
              decision !== 'cancel') ||
            (interaction.details?.kind === 'approval' &&
              interaction.details.choices.length > 0 &&
              !interaction.details.choices.some((choice) => choice.id === decision))
          )
            throw new OwnerMethodError('INVALID_PARAMS')
          return replyToInteraction(owner.ownerId, threadId, requestId, decision)
        }
        default:
          throw new OwnerMethodError('INVALID_PARAMS')
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
      } catch (error) {
        throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
      }
      return { deleted: true }
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
        if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
      }
      const latestSequence = dependencies.codex.events.latestEventId(
        owner.ownerId,
        scope === 'thread' ? (threadId as string) : undefined,
      )
      const cursor = parseEventCursor(input.cursor)
      if (cursor === null) throw new OwnerMethodError('INVALID_EVENT_CURSOR')
      const requestedSequence = cursor?.sequence ?? latestSequence
      const threadFilter = scope === 'thread' ? (threadId as string) : undefined
      const expired = await dependencies.codex.events.isCursorExpired?.(
        owner.ownerId,
        threadFilter,
        requestedSequence,
      )
      const effectiveResetReason =
        cursor?.epoch !== undefined && cursor.epoch !== eventEpoch(owner.ownerId)
          ? 'epoch_changed'
          : (cursor &&
                (dependencies.codex.events.isCursorAhead?.(
                  owner.ownerId,
                  threadFilter,
                  cursor.sequence,
                ) ??
                  cursor.sequence > latestSequence)) ||
              expired
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
            new Promise<void>((resolve, reject) => {
              let stopped = false
              let unsubscribe: (() => unknown) | undefined
              const stop = () => {
                stopped = true
                signal.removeEventListener('abort', abort)
                unsubscribe?.()
              }
              const abort = () => {
                stop()
                resolve()
              }
              const reset = (reason: 'epoch_changed' | 'cursor_gap') => {
                if (stopped) return
                stop()
                void emit({
                  method: 'events.reset',
                  params: {
                    cursor: makeEventCursor(
                      owner.ownerId,
                      dependencies.codex.events.latestEventId(owner.ownerId, threadFilter),
                    ),
                    reason,
                  },
                }).then(resolve, reject)
              }
              if (signal.aborted) return abort()
              signal.addEventListener('abort', abort, { once: true })
              if (effectiveResetReason) {
                reset(effectiveResetReason)
                return
              }
              const events = dependencies.codex.events
              type Subscribe = NonNullable<typeof events.subscribeFrom>
              const subscribe: (
                ...args: [...Parameters<Subscribe>, onGap: () => void]
              ) => ReturnType<Subscribe> =
                events.subscribeFrom?.bind(events) ??
                (async (...args: Parameters<Subscribe>) => events.subscribe(...args))
              void subscribe(
                owner.ownerId,
                threadFilter,
                requestedSequence,
                (event) => {
                  if (stopped) return
                  void emit({
                    cursor: makeEventCursor(owner.ownerId, event.id),
                    event: event.message,
                  }).catch((error) => {
                    stop()
                    reject(error)
                  })
                },
                () => reset('cursor_gap'),
              )
                .then((cleanup) => {
                  unsubscribe = cleanup
                  if (stopped) cleanup()
                  return undefined
                })
                .catch(() => reset('cursor_gap'))
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
  }

  return {
    ...services,
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

  async function startConversationTurn(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
  ) {
    const owner = requireOwner(context)
    const threadId = input.threadId
    const projectId = input.projectId
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    const model = typeof input.model === 'string' ? input.model.trim() : ''
    const reasoningEffort = input.reasoningEffort
    const collaborationMode = input.collaborationMode
    const selection = parseSkills(input.skills)
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
      selection === null
    )
      throw new OwnerMethodError('INVALID_TURN_REQUEST')
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
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
      access.scope === 'project' ? access.cwd : userRoot,
      selection,
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
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  async function steerConversationTurn(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
  ) {
    const owner = requireOwner(context)
    const part = Array.isArray(input.input) && input.input.length === 1 ? input.input[0] : undefined
    const selection = parseSkills(input.skills)
    if (
      !safeId(input.threadId) ||
      !safeId(input.expectedTurnId) ||
      !isRecord(part) ||
      part.type !== 'text' ||
      !safeId(part.id) ||
      typeof part.text !== 'string' ||
      !part.text.trim() ||
      part.text.length > MAX_INITIAL_MESSAGE_LENGTH ||
      selection === null
    )
      throw new OwnerMethodError('INVALID_TURN_REQUEST')
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId: input.threadId,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    const skills = await resolveSelectedSkills(
      access.client,
      access.scope === 'project' ? access.cwd : dependencies.workspace.getUserRoot(owner.ownerId),
      selection,
    )
    if (!skills) throw new OwnerMethodError('INVALID_TURN_REQUEST')
    try {
      const result = await access.client.request('turn/steer', {
        threadId: input.threadId,
        expectedTurnId: input.expectedTurnId,
        input: turnInput(part.text, skills),
      })
      if (!isRecord(result) || result.turnId !== input.expectedTurnId)
        throw new OwnerMethodError('CODEX_PROTOCOL_ERROR')
      return { turnId: result.turnId }
    } catch (error) {
      if (error instanceof OwnerMethodError) throw error
      throw new OwnerMethodError(
        error instanceof CodexRpcRequestError ? 'INVALID_TURN_REQUEST' : 'CODEX_UNAVAILABLE',
        false,
        { cause: error },
      )
    }
  }

  async function cancelConversationTurn(
    context: OwnerMethodContext,
    input: Record<string, unknown>,
  ) {
    const owner = requireOwner(context)
    if (!safeId(input.threadId) || !safeId(input.turnId))
      throw new OwnerMethodError('INVALID_TURN_REQUEST')
    const threadId = input.threadId
    const turnId = input.turnId
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    if (dependencies.codex.cancelQueuedTurn?.(owner.ownerId, turnId)) return { cancelled: true }
    try {
      const result = await access.client.request('turn/interrupt', { threadId, turnId })
      return { result }
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  async function compactConversation(context: OwnerMethodContext, input: Record<string, unknown>) {
    const owner = requireOwner(context)
    if (!safeId(input.threadId)) throw new OwnerMethodError('INVALID_THREAD')
    const access = await threadDomain.access({
      userId: owner.ownerId,
      threadId: input.threadId,
      mode: 'mutation',
    })
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    try {
      await access.client.request('thread/compact/start', { threadId: input.threadId })
      return { accepted: true }
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  function replyToInteraction(
    ownerId: string,
    threadId: string,
    requestId: string | number,
    result: unknown,
  ) {
    const respond = dependencies.codex.respondToServerRequest
    if (!respond) throw new OwnerMethodError('INVALID_PARAMS')
    try {
      respond.call(dependencies.codex, ownerId, threadId, requestId, result)
      return { accepted: true }
    } catch (error) {
      throw new OwnerMethodError('RESOURCE_NOT_FOUND', false, { cause: error })
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
    if (access.kind !== 'owned') throw mapThreadAccessFailure(access)
    try {
      await access.client.request(method, { threadId: input.threadId })
      return { accepted: true }
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
    }
  }

  async function readyClient(ownerId: string) {
    if (!dependencies.codex.getReady) throw new OwnerMethodError('CODEX_START_REQUIRED', true)
    try {
      return await dependencies.codex.getReady(ownerId)
    } catch (error) {
      throw new OwnerMethodError('CODEX_UNAVAILABLE', true, { cause: error })
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

function requireOwner(context: OwnerMethodContext): OwnerContext {
  if (!context.owner) throw new OwnerMethodError('UNAUTHORIZED')
  return context.owner
}
