import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ServerConfig } from '../config.js'
import type { WorkspaceService } from '../workspace.js'
import { CodexRpcClient, type RpcTransport } from './rpc-client.js'
import { EventHub } from './event-hub.js'
import { CodexStdioTransport } from './stdio-transport.js'
import { projectNativeMessage } from './native-protocol.js'
import { CodexRuntimeManager } from './runtime-manager.js'
import type { CodexCommand } from './stdio-transport.js'

type Instance = { client: CodexRpcClient; credentialId: string }
export type CodexLifecycleStatus = 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'
export type CodexStatus = {
  status: CodexLifecycleStatus
  projectId: string | null
  activeCredentialId: string | null
  pendingCredentialId: string | null
  restartRequired: boolean
  activeTurns?: number
  error: string | null
  dangerousAccessConfirmed?: boolean
}
type TurnTask = {
  id: string
  scope: string
  run: (signal: AbortSignal) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  controller: AbortController
  timer?: NodeJS.Timeout
  settled: boolean
}
type RequestId = number | string
type PendingServerRequest = { client: CodexRpcClient; threadId: string }
type ActiveTurn = { threadId: string; turnId: string }
export class CodexLifecycleError extends Error {
  readonly code: 'CODEX_START_REQUIRED' | 'CODEX_UNAVAILABLE'
  constructor(code: 'CODEX_START_REQUIRED' | 'CODEX_UNAVAILABLE', message: string) {
    super(message)
    this.code = code
  }
}

export class CodexManager {
  readonly events = new EventHub()
  private readonly instances = new Map<string, Promise<Instance>>()
  private readonly activeClients = new Map<string, CodexRpcClient>()
  private readonly config: ServerConfig
  private readonly workspace: WorkspaceService
  private readonly transportFactory: (
    command: CodexCommand,
    options: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => RpcTransport
  private readonly injectedTransport: boolean
  private readonly runtime: CodexRuntimeManager
  private readonly active = new Map<string, number>()
  private readonly queues = new Map<string, TurnTask[]>()
  private readonly activeTasks = new Map<string, Set<TurnTask>>()
  private readonly activeScopes = new Map<string, Set<string>>()
  private readonly serverRequests = new Map<string, Map<RequestId, PendingServerRequest>>()
  private readonly lifecycle = new Map<string, CodexStatus>()
  private readonly activeTurnsByUser = new Map<string, Map<string, ActiveTurn>>()
  private readonly loadedThreads = new Map<string, Set<string>>()
  private readonly stopping = new Set<string>()
  private readonly dangerousAccessConfirmed = new Set<string>()

  constructor(
    config: ServerConfig,
    workspace: WorkspaceService,
    transportFactory: (
      command: CodexCommand,
      options: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => RpcTransport = CodexManager.defaultTransportFactory,
    runtime = new CodexRuntimeManager(config),
  ) {
    this.config = config
    this.workspace = workspace
    this.injectedTransport = transportFactory !== CodexManager.defaultTransportFactory
    this.transportFactory = transportFactory
    this.runtime = runtime
  }

  private static readonly defaultTransportFactory = (
    command: CodexCommand,
    options: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) => new CodexStdioTransport(command, options)

  get(userId: string, projectId: string, credentialId: string): Promise<CodexRpcClient> {
    const existing = this.instances.get(userId)
    const current = this.lifecycle.get(userId)
    if (existing && current?.activeCredentialId === credentialId && current.status === 'ready')
      return this.clientFrom(userId, existing)
    if (existing && current?.activeCredentialId && current.activeCredentialId !== credentialId) {
      this.lifecycle.set(userId, {
        ...current,
        pendingCredentialId: credentialId,
        restartRequired: true,
      })
      return this.clientFrom(userId, existing)
    }
    this.lifecycle.set(userId, {
      status: this.instances.has(userId) ? 'restarting' : 'starting',
      projectId,
      activeCredentialId: credentialId,
      pendingCredentialId: null,
      restartRequired: false,
      error: null,
      dangerousAccessConfirmed: this.dangerousAccessConfirmed.has(userId),
    })
    if (!existing) {
      const starting = this.startProcessWithRuntimeFallback(userId, projectId, credentialId)
      this.instances.set(userId, starting)
      return this.clientFrom(userId, starting).then(
        (client) => {
          this.lifecycle.set(userId, {
            status: 'ready',
            projectId,
            activeCredentialId: credentialId,
            pendingCredentialId: null,
            restartRequired: false,
            error: null,
          })
          void this.runtime.markRestarted()
          return client
        },
        (error: unknown) => {
          this.lifecycle.set(userId, {
            status: 'failed',
            projectId,
            activeCredentialId: credentialId,
            pendingCredentialId: null,
            restartRequired: false,
            error: error instanceof Error ? error.message : 'Codex failed to start',
          })
          throw error
        },
      )
    }
    const switching = existing.then((instance) => instance)
    this.instances.set(userId, switching)
    if (this.lifecycle.get(userId)?.activeCredentialId !== credentialId)
      this.lifecycle.set(userId, {
        ...(this.lifecycle.get(userId) ?? {
          status: 'ready',
          projectId,
          activeCredentialId: credentialId,
          error: null,
        }),
        pendingCredentialId: credentialId,
        restartRequired: true,
      })
    return this.clientFrom(userId, switching)
  }

  getStatus(userId: string): CodexStatus {
    const current = this.lifecycle.get(userId) ?? {
      status: 'stopped' as const,
      projectId: null,
      activeCredentialId: null,
      pendingCredentialId: null,
      restartRequired: false,
      error: null,
    }
    return {
      ...current,
      dangerousAccessConfirmed: this.dangerousAccessConfirmed.has(userId),
      activeTurns: Math.max(
        this.activeTasks.get(userId)?.size ?? 0,
        this.activeTurnsByUser.get(userId)?.size ?? 0,
      ),
    }
  }

  async getReady(userId: string): Promise<CodexRpcClient> {
    const status = this.lifecycle.get(userId)
    const instance = this.instances.get(userId)
    if (!instance || !status || status.status === 'stopped')
      throw new CodexLifecycleError('CODEX_START_REQUIRED', 'Start Codex before using threads')
    if (status.status !== 'ready')
      throw new CodexLifecycleError(
        'CODEX_UNAVAILABLE',
        status.error ?? 'Codex App Server unavailable',
      )
    try {
      return (await instance).client
    } catch {
      throw new CodexLifecycleError('CODEX_UNAVAILABLE', 'Codex App Server unavailable')
    }
  }

  markCredentialPending(userId: string, credentialId: string) {
    const current = this.lifecycle.get(userId)
    if (!current?.activeCredentialId || current.activeCredentialId === credentialId) return
    this.lifecycle.set(userId, {
      ...current,
      pendingCredentialId: credentialId,
      restartRequired: true,
    })
  }

  markDangerousAccessConfirmed(userId: string) {
    this.dangerousAccessConfirmed.add(userId)
  }

  async start(userId: string, projectId: string, credentialId: string) {
    return this.get(userId, projectId, credentialId)
  }

  async restart(userId: string, projectId: string, credentialId: string) {
    for (const turn of this.activeTurnsByUser.get(userId)?.values() ?? [])
      void this.events.publish(userId, {
        method: 'turn/completed',
        params: { threadId: turn.threadId, turn: { id: turn.turnId, status: 'interrupted' } },
      })
    this.lifecycle.set(userId, {
      status: 'restarting',
      projectId,
      activeCredentialId: credentialId,
      pendingCredentialId: null,
      restartRequired: false,
      error: null,
    })
    this.rejectQueued(userId, new Error('Codex restart requested'))
    await this.stop(userId)
    const starting = this.startProcessWithRuntimeFallback(userId, projectId, credentialId)
    this.instances.set(userId, starting)
    try {
      const instance = await starting
      this.activeClients.set(userId, instance.client)
      this.lifecycle.set(userId, {
        status: 'ready',
        projectId,
        activeCredentialId: credentialId,
        pendingCredentialId: null,
        restartRequired: false,
        error: null,
      })
      await this.runtime.markRestarted()
      return instance.client
    } catch (error) {
      this.lifecycle.set(userId, {
        status: 'failed',
        projectId,
        activeCredentialId: credentialId,
        pendingCredentialId: null,
        restartRequired: false,
        error: error instanceof Error ? error.message : 'Codex failed to start',
      })
      throw error
    }
  }

  async stop(userId: string) {
    const existing = this.instances.get(userId)
    if (!existing) return
    this.instances.delete(userId)
    this.dangerousAccessConfirmed.delete(userId)
    const current = this.lifecycle.get(userId)
    this.lifecycle.set(userId, {
      status: 'stopped',
      projectId: current?.projectId ?? null,
      activeCredentialId: current?.activeCredentialId ?? null,
      pendingCredentialId: current?.pendingCredentialId ?? null,
      restartRequired: current?.restartRequired ?? false,
      error: null,
    })
    this.rejectQueued(userId, new Error('Codex App Server stopped'))
    this.serverRequests.delete(userId)
    this.activeTurnsByUser.delete(userId)
    this.loadedThreads.delete(userId)
    let instance: Instance | undefined
    try {
      instance = await existing
    } catch {
      // A failed start has no client to stop; restart can continue with a clean slot.
      this.activeClients.delete(userId)
      return
    }
    if (this.activeClients.get(userId) === instance.client) this.activeClients.delete(userId)
    this.stopping.add(userId)
    instance.client.stop()
  }

  markThreadLoaded(userId: string, threadId: string) {
    const threads = this.loadedThreads.get(userId) ?? new Set<string>()
    threads.add(threadId)
    this.loadedThreads.set(userId, threads)
  }

  async ensureThread(userId: string, threadId: string) {
    const threads = this.loadedThreads.get(userId) ?? new Set<string>()
    if (threads.has(threadId)) return
    const client = await this.getReady(userId)
    await client.request('thread/resume', { threadId })
    threads.add(threadId)
    this.loadedThreads.set(userId, threads)
  }

  private async clientFrom(userId: string, instancePromise: Promise<Instance>) {
    try {
      return (await instancePromise).client
    } catch (error) {
      if (this.instances.get(userId) === instancePromise) this.instances.delete(userId)
      throw error
    }
  }

  async shutdown() {
    for (const userId of this.queues.keys())
      this.rejectQueued(userId, new Error('Codex manager shut down'))
    for (const userId of this.instances.keys()) await this.stop(userId)
  }

  respondToServerRequest(userId: string, threadId: string, requestId: RequestId, result: unknown) {
    if (typeof requestId !== 'number') throw new Error('Approval request id must be numeric')
    const requests = this.serverRequests.get(userId)
    const pending = requests?.get(requestId)
    if (!pending || pending.threadId !== threadId) throw new Error('Approval request not found')
    requests!.delete(requestId)
    pending.client.respond(requestId, result)
  }

  enqueueTurn(
    userId: string,
    run: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs = 120_000,
    taskId: string = crypto.randomUUID(),
    scope = '__global__',
  ) {
    return new Promise<unknown>((resolve, reject) => {
      const task: TurnTask = {
        id: taskId,
        scope,
        run,
        resolve,
        reject,
        controller: new AbortController(),
        settled: false,
      }
      task.timer = setTimeout(
        () => this.abortTask(userId, task, new Error('Turn timed out')),
        timeoutMs,
      )
      const queue = this.queues.get(userId) ?? []
      queue.push(task)
      this.queues.set(userId, queue)
      this.drain(userId)
    })
  }

  cancelQueuedTurn(userId: string, taskId?: string) {
    const queue = this.queues.get(userId)
    const index = taskId ? (queue?.findIndex((task) => task.id === taskId) ?? -1) : 0
    const task =
      index >= 0
        ? queue?.splice(index, 1)[0]
        : [...(this.activeTasks.get(userId) ?? [])].find((value) => value.id === taskId)
    if (!task) return false
    this.abortTask(userId, task, new Error('Turn cancelled'))
    return true
  }

  private rejectQueued(userId: string, error: Error) {
    const queue = this.queues.get(userId) ?? []
    this.queues.delete(userId)
    for (const task of queue) {
      this.abortTask(userId, task, error)
    }
    for (const task of this.activeTasks.get(userId) ?? []) this.abortTask(userId, task, error)
  }

  private abortTask(userId: string, task: TurnTask, error: Error) {
    if (task.settled) return
    task.settled = true
    if (task.timer) clearTimeout(task.timer)
    task.controller.abort(error)
    task.reject(error)
    const active = this.activeTasks.get(userId)
    if (active?.delete(task))
      this.active.set(userId, Math.max(0, (this.active.get(userId) ?? 1) - 1))
    this.drain(userId)
  }

  private drain(userId: string) {
    const limit = this.config.maxActiveTasksPerUser
    const queue = this.queues.get(userId) ?? []
    while ((this.active.get(userId) ?? 0) < limit && queue.length) {
      const index = queue.findIndex((task) => !this.activeScopes.get(userId)?.has(task.scope))
      if (index < 0) break
      const task = queue.splice(index, 1)[0]
      if (task.settled) continue
      this.active.set(userId, (this.active.get(userId) ?? 0) + 1)
      const scopes = this.activeScopes.get(userId) ?? new Set<string>()
      scopes.add(task.scope)
      this.activeScopes.set(userId, scopes)
      const activeTasks = this.activeTasks.get(userId) ?? new Set()
      activeTasks.add(task)
      this.activeTasks.set(userId, activeTasks)
      void task
        .run(task.controller.signal)
        .then(
          (value) => {
            if (!task.settled) {
              task.settled = true
              task.resolve(value)
            }
            return undefined
          },
          (error: unknown) => {
            if (!task.settled) {
              task.settled = true
              task.reject(error instanceof Error ? error : new Error(String(error)))
            }
          },
        )
        .finally(() => {
          if (task.timer) clearTimeout(task.timer)
          if (activeTasks.delete(task))
            this.active.set(userId, Math.max(0, (this.active.get(userId) ?? 1) - 1))
          const trackedScopes = this.activeScopes.get(userId)
          trackedScopes?.delete(task.scope)
          this.drain(userId)
        })
    }
  }

  private async startProcess(
    userId: string,
    _projectId: string,
    credentialId: string,
  ): Promise<Instance> {
    const credential = await this.workspace.getCredential(userId, credentialId)
    if (!credential) throw new Error('Credential not found')
    const userRoot = path.resolve(this.config.dataRoot, 'users', userId)
    const userHome = path.join(userRoot, '.codex')
    await mkdir(userHome, { recursive: true })
    const configPath = path.join(userHome, 'config.toml')
    const provider = JSON.stringify(credential.provider)
    const configText = [
      `model_provider = ${provider}`,
      '',
      `[model_providers.${provider}]`,
      `name = ${provider}`,
      `base_url = ${JSON.stringify(credential.baseUrl)}`,
      'wire_api = "responses"',
      'requires_openai_auth = true',
      '',
    ].join('\n')
    const tempConfigPath = `${configPath}.${process.pid}.tmp`
    await writeFile(tempConfigPath, configText, { encoding: 'utf8', mode: 0o600 })
    await rename(tempConfigPath, configPath)
    const command = this.injectedTransport
      ? { executable: 'codex', args: [] }
      : await this.runtime.resolveCommand()
    const transport = this.transportFactory(command, {
      cwd: userRoot,
      env: {
        CODEX_HOME: userHome,
      },
    })
    const client = new CodexRpcClient(transport)
    client.onClose(() => {
      if (this.stopping.has(userId)) {
        this.stopping.delete(userId)
        return
      }
      if (this.activeClients.get(userId) === client) {
        this.activeClients.delete(userId)
        this.instances.delete(userId)
      }
      this.rejectQueued(userId, new Error('Codex App Server exited'))
      this.serverRequests.delete(userId)
      const current = this.lifecycle.get(userId)
      this.lifecycle.set(userId, {
        status: 'failed',
        projectId: current?.projectId ?? null,
        activeCredentialId: current?.activeCredentialId ?? null,
        pendingCredentialId: current?.pendingCredentialId ?? null,
        restartRequired: current?.restartRequired ?? false,
        error: 'Codex App Server exited',
      })
    })
    client.onEvent((message) => {
      const params = message.params as Record<string, unknown> | undefined
      const threadId = typeof params?.threadId === 'string' ? params.threadId : undefined
      const turn = params?.turn as Record<string, unknown> | undefined
      const turnId =
        typeof turn?.id === 'string'
          ? turn.id
          : typeof params?.turnId === 'string'
            ? params.turnId
            : undefined
      if (threadId && turnId && typeof message.method === 'string') {
        const map = this.activeTurnsByUser.get(userId) ?? new Map<string, ActiveTurn>()
        if (message.method === 'turn/started') map.set(turnId, { threadId, turnId })
        if (message.method === 'turn/completed' || message.method === 'turn/failed')
          map.delete(turnId)
        this.activeTurnsByUser.set(userId, map)
      }
      const projected = projectNativeMessage(message)
      void this.events.publish(
        userId,
        projected.ok
          ? projected.value
          : {
              method: 'webcodex/protocol-error',
              params: {
                code: projected.code,
                ...(typeof params?.threadId === 'string' ? { threadId: params.threadId } : {}),
                ...(typeof params?.turnId === 'string' ? { turnId: params.turnId } : {}),
              },
            },
      )
    })
    client.onRequest((message) => {
      const requestId = message.id
      const params = message.params as Record<string, unknown> | undefined
      if (
        (typeof requestId !== 'number' && typeof requestId !== 'string') ||
        typeof params?.threadId !== 'string'
      ) {
        if (typeof requestId === 'number')
          client.respondError(requestId, { code: -32602, message: 'threadId is required' })
        return
      }
      const requests = this.serverRequests.get(userId) ?? new Map()
      requests.set(requestId, { client, threadId: params.threadId })
      this.serverRequests.set(userId, requests)
      const projected = projectNativeMessage(message)
      void this.events.publish(
        userId,
        projected.ok
          ? projected.value
          : {
              method: 'webcodex/protocol-error',
              params: {
                code: projected.code,
                ...(typeof params?.threadId === 'string' ? { threadId: params.threadId } : {}),
              },
            },
      )
    })
    try {
      await client.initialize()
      await client.request('account/login/start', { type: 'apiKey', apiKey: credential.apiKey })
      const account = (await client.request('account/read', {})) as {
        account?: { type?: unknown }
        requiresOpenaiAuth?: unknown
      }
      if (account.account?.type !== 'apiKey' || account.requiresOpenaiAuth !== true) {
        throw new Error('Codex API-key authentication verification failed')
      }
    } catch (error) {
      client.stop()
      throw error
    }
    this.activeClients.set(userId, client)
    return { client, credentialId }
  }

  private async startProcessWithRuntimeFallback(
    userId: string,
    projectId: string,
    credentialId: string,
  ): Promise<Instance> {
    try {
      return await this.startProcess(userId, projectId, credentialId)
    } catch (error) {
      try {
        const before = await this.runtime.status()
        // Only roll back an explicitly pending runtime activation. Credential or
        // provider failures must not silently change the selected binary.
        if (!before.activeVersion || !before.restartRequired) throw error
        const rolledBack = await this.runtime.rollback()
        if (rolledBack.activeVersion === before.activeVersion) throw error
        return await this.startProcess(userId, projectId, credentialId)
      } catch {
        throw error
      }
    }
  }
}
