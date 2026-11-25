import type { ServerConfig } from '../config.js'
import type { WorkspaceService } from '../workspace.js'
import type { CodexRpcClient, RpcTransport } from './rpc-client.js'
import { EventHub } from './event-hub.js'
import { CodexStdioTransport, type CodexCommand } from './stdio-transport.js'
import type { RequestId } from './request-id.js'
import { CodexRuntimeManager } from './runtime-manager.js'
import { TurnScheduler } from './turn-scheduler.js'
import { projectModelCatalog, type RuntimeModel } from './model-catalog.js'
import { ProcessEvents } from './process/events.js'
import { startCodexProcess } from './process/startup.js'
import type { CodexOwnerPort } from './owner-port.js'

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
}
export class CodexLifecycleError extends Error {
  readonly code: 'CODEX_START_REQUIRED' | 'CODEX_UNAVAILABLE'
  constructor(code: 'CODEX_START_REQUIRED' | 'CODEX_UNAVAILABLE', message: string) {
    super(message)
    this.code = code
  }
}

export class CodexManager implements CodexOwnerPort {
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
  private readonly turnScheduler = new TurnScheduler()
  private readonly processEvents = new ProcessEvents(this.events)
  private readonly lifecycle = new Map<string, CodexStatus>()
  private readonly loadedThreads = new Map<string, Set<string>>()
  private readonly stopping = new Set<string>()

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
    })
    if (!existing) {
      const starting = this.startProcessWithRuntimeFallback(userId, projectId, credentialId)
      this.instances.set(userId, starting)
      return this.clientFrom(userId, starting).then(
        async (client) => {
          this.lifecycle.set(userId, {
            status: 'ready',
            projectId,
            activeCredentialId: credentialId,
            pendingCredentialId: null,
            restartRequired: false,
            error: null,
          })
          await this.runtime.markRestarted()
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
      activeTurns: Math.max(
        this.turnScheduler.activeCount(userId),
        this.processEvents.activeCount(userId),
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

  async modelCatalog(userId: string): Promise<RuntimeModel[]> {
    const client = await this.getReady(userId)
    return projectModelCatalog(
      await client.request('model/list', { limit: 100, includeHidden: false }),
    )
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

  async start(userId: string, projectId: string, credentialId: string) {
    return this.get(userId, projectId, credentialId)
  }

  async restart(userId: string, projectId: string, credentialId: string) {
    this.processEvents.cancelActiveTurns(userId)
    this.lifecycle.set(userId, {
      status: 'restarting',
      projectId,
      activeCredentialId: credentialId,
      pendingCredentialId: null,
      restartRequired: false,
      error: null,
    })
    this.turnScheduler.rejectUser(userId, new Error('Codex restart requested'))
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
    const current = this.lifecycle.get(userId)
    this.lifecycle.set(userId, {
      status: 'stopped',
      projectId: current?.projectId ?? null,
      activeCredentialId: current?.activeCredentialId ?? null,
      pendingCredentialId: current?.pendingCredentialId ?? null,
      restartRequired: current?.restartRequired ?? false,
      error: null,
    })
    this.turnScheduler.rejectUser(userId, new Error('Codex App Server stopped'))
    const activeClient = this.activeClients.get(userId)
    if (activeClient) this.processEvents.expireServerRequests(userId, activeClient)
    this.processEvents.clearActivity(userId)
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
    this.processEvents.expireServerRequests(userId, instance.client)
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
    this.turnScheduler.shutdown(new Error('Codex manager shut down'))
    for (const userId of this.instances.keys()) {
      // oxlint-disable-next-line no-await-in-loop
      await this.stop(userId)
    }
  }

  respondToServerRequest(userId: string, threadId: string, requestId: RequestId, result: unknown) {
    return this.processEvents.respondToServerRequest(userId, threadId, requestId, result)
  }

  enqueueTurn(
    userId: string,
    run: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs = 120_000,
    taskId: string = crypto.randomUUID(),
    scope = '__global__',
  ) {
    return this.turnScheduler.enqueue(userId, run, timeoutMs, taskId, scope)
  }

  cancelQueuedTurn(userId: string, taskId?: string) {
    return this.turnScheduler.cancel(userId, taskId)
  }

  private async startProcess(
    userId: string,
    _projectId: string,
    credentialId: string,
  ): Promise<Instance> {
    const instance = await startCodexProcess(
      {
        config: this.config,
        workspace: this.workspace,
        runtime: this.runtime,
        injectedTransport: this.injectedTransport,
        transportFactory: this.transportFactory,
        attach: (client, endpointHost) => {
          client.onClose(() => {
            this.processEvents.expireServerRequests(userId, client)
            if (this.stopping.has(userId)) {
              this.stopping.delete(userId)
              return
            }
            if (this.activeClients.get(userId) === client) {
              this.activeClients.delete(userId)
              this.instances.delete(userId)
            }
            this.turnScheduler.rejectUser(userId, new Error('Codex App Server exited'))
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
          this.processEvents.attach(userId, client, endpointHost)
        },
      },
      userId,
      credentialId,
    )
    const { client } = instance
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
