import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { GuestConfig, ServerConfig } from './config.js'
import type { GuestRuntimeContract, GuestRuntimeStatus } from '../src/lib/bridge/guest-contract.js'
import { CodexRpcClient, type RpcTransport } from './codex/rpc-client.js'
import { EventHub } from './codex/event-hub.js'
import { CodexStdioTransport } from './codex/stdio-transport.js'
import { requestIdCandidates, type RequestId } from './codex/request-id.js'
import type { CodexRuntimeManager } from './codex/runtime-manager.js'
import { describeUnknown, log } from './logger.js'

export type { GuestRuntimeStatus }
export type GuestRuntime = GuestRuntimeContract

export function extractWindowsConfig(config: string): string {
  const lines = config.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === '[windows]')
  if (start < 0) return ''
  const end = lines.findIndex((line, index) => index > start && /^\[[^\]]+\]\s*$/.test(line.trim()))
  return lines
    .slice(start, end < 0 ? lines.length : end)
    .join('\n')
    .trim()
}

export const GUEST_DEVELOPER_INSTRUCTIONS = [
  'You are running in an isolated guest workspace.',
  'Only read, write, and execute files inside the provided guest workspace.',
  'Never request elevated permissions, inspect credentials, access host files, configure MCP or plugins, or use unrestricted network access.',
].join(' ')

type GuestInstance = { client: CodexRpcClient; home: string }
export type GuestUserInputResponse = {
  requestId: RequestId
  answers: Record<string, { answers: string[] }>
}

export class GuestCodexManager {
  readonly events = new EventHub()
  private readonly config: ServerConfig
  private readonly guest: GuestConfig
  private readonly runtime: CodexRuntimeManager
  private readonly transportFactory: (
    command: string | { executable: string; args?: string[] },
    options: { cwd?: string; env?: NodeJS.ProcessEnv; inheritEnv?: boolean },
  ) => RpcTransport
  private onMessage?: (message: Record<string, unknown>) => void | Promise<void>
  private instance: Promise<GuestInstance> | null = null
  private status: GuestRuntimeStatus = 'stopped'
  private readonly loadedThreads = new Set<string>()
  private readonly threadWorkspaces = new Map<string, string>()
  private readonly skillHandles = new Map<
    string,
    { guestId: string; expiresAt: number; name: string; path: string }
  >()
  private readonly pendingUserInput = new Map<
    number | string,
    { threadId: string; questionIds: Set<string> }
  >()
  private skillsMirrored = false
  private readonly mirroredSkillsRoot: string

  constructor(
    config: ServerConfig,
    runtime: CodexRuntimeManager,
    transportFactory: (
      command: string | { executable: string; args?: string[] },
      options: { cwd?: string; env?: NodeJS.ProcessEnv; inheritEnv?: boolean },
    ) => RpcTransport = (command, options) => new CodexStdioTransport(command, options),
    onMessage?: (message: Record<string, unknown>) => void | Promise<void>,
  ) {
    if (!config.guest) throw new Error('Guest runtime configuration is required')
    this.config = config
    this.guest = config.guest
    this.runtime = runtime
    this.transportFactory = transportFactory
    this.onMessage = onMessage
    this.mirroredSkillsRoot = path.resolve(config.dataRoot, 'guest', 'skills')
  }

  setMessageHandler(handler: (message: Record<string, unknown>) => void | Promise<void>) {
    this.onMessage = handler
  }

  getRuntime(): GuestRuntime {
    return {
      kind: 'guest-runtime',
      status: this.status,
      maxActiveThreads: this.guest.maxActiveThreads,
      modelContextWindow: this.guest.modelContextWindow,
      sandbox: 'workspaceWrite',
      network: 'disabled',
    }
  }

  async start() {
    if (this.instance) return this.instance
    this.status = 'starting'
    const starting = this.startProcess()
    this.instance = starting
    try {
      const instance = await starting
      this.status = 'ready'
      return instance.client
    } catch (error) {
      this.status = 'failed'
      this.instance = null
      throw new Error('Guest runtime failed to start', { cause: error })
    }
  }

  async stop() {
    const instance = this.instance
    this.instance = null
    this.loadedThreads.clear()
    this.threadWorkspaces.clear()
    this.skillsMirrored = false
    this.status = 'stopped'
    if (!instance) return
    try {
      ;(await instance).client.stop()
    } catch {
      /* already stopped */
    }
  }

  async ready() {
    if (this.status !== 'ready' || !this.instance) throw new Error('Guest runtime is unavailable')
    return (await this.instance).client
  }

  async createThread(guestWorkspace: string) {
    const client = await this.ready()
    const result = await client.request('thread/start', {
      cwd: guestWorkspace,
      developerInstructions: GUEST_DEVELOPER_INSTRUCTIONS,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    })
    const thread = (result as { thread?: { id?: unknown } }).thread
    if (!thread || typeof thread.id !== 'string')
      throw new Error('Guest runtime returned an invalid thread')
    this.loadedThreads.add(thread.id)
    this.threadWorkspaces.set(thread.id, guestWorkspace)
    return thread.id
  }

  async resumeThread(nativeThreadId: string, guestWorkspace?: string) {
    if (this.loadedThreads.has(nativeThreadId)) return
    const client = await this.ready()
    await client.request('thread/resume', { threadId: nativeThreadId })
    this.loadedThreads.add(nativeThreadId)
    if (guestWorkspace) this.threadWorkspaces.set(nativeThreadId, guestWorkspace)
  }

  async startTurn(
    nativeThreadId: string,
    text: string,
    model: string,
    effort: string,
    guestId: string,
    selectedSkills: readonly string[] = [],
    collaborationMode: 'default' | 'plan' = 'plan',
    signal?: AbortSignal,
  ) {
    const workspace = this.threadWorkspaces.get(nativeThreadId)
    if (!workspace) throw new Error('Guest thread workspace is unavailable')
    await this.resumeThread(nativeThreadId, workspace)
    const client = await this.ready()
    const result = await client.request(
      'turn/start',
      {
        threadId: nativeThreadId,
        input: this.skillInput(guestId, text, selectedSkills),
        model,
        effort,
        collaborationMode: {
          mode: collaborationMode,
          settings: { model, reasoning_effort: effort },
        },
        approvalPolicy: 'never',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [workspace],
          networkAccess: false,
        },
      },
      signal,
    )
    const turn = (result as { turn?: { id?: unknown } }).turn
    if (!turn || typeof turn.id !== 'string')
      throw new Error('Guest runtime returned an invalid turn')
    return turn.id
  }

  async interrupt(nativeThreadId: string, nativeTurnId: string) {
    const client = await this.ready()
    await client.request('turn/interrupt', { threadId: nativeThreadId, turnId: nativeTurnId })
  }

  async compact(nativeThreadId: string) {
    const client = await this.ready()
    await client.request('thread/compact/start', { threadId: nativeThreadId })
  }

  async respondUserInput(
    requestId: RequestId,
    nativeThreadId: string,
    answers: unknown,
  ): Promise<GuestUserInputResponse> {
    const resolvedId = requestIdCandidates(requestId).find((candidate) =>
      this.pendingUserInput.has(candidate),
    )
    const pending = resolvedId === undefined ? undefined : this.pendingUserInput.get(resolvedId)
    if (!pending || pending.threadId !== nativeThreadId)
      throw new Error('Guest user input request is unavailable')
    const safeAnswers = normalizeUserInputAnswers(answers, pending.questionIds)
    if (!safeAnswers) throw new Error('Guest user input answer is invalid')
    const client = await this.ready()
    client.respond(resolvedId!, { answers: safeAnswers })
    this.pendingUserInput.delete(resolvedId!)
    return { requestId: resolvedId!, answers: safeAnswers }
  }

  async prepareWorkspace(guestPublicId: string) {
    const workspace = this.resolveGuestWorkspace(guestPublicId)
    const root = path.dirname(workspace)
    await mkdir(root, { recursive: true })
    await mkdir(workspace, { recursive: true })
    return workspace
  }

  async listSkills(guestId: string) {
    await this.ensureSkillsMirrored()
    const client = await this.ready()
    await client.request('skills/extraRoots/set', { extraRoots: [this.mirroredSkillsRoot] })
    const result = (await client.request('skills/list', {
      cwds: [this.mirroredSkillsRoot],
      forceReload: true,
    })) as {
      data?: Array<{ skills?: Array<Record<string, unknown>> }>
    }
    return (result.data?.[0]?.skills ?? []).flatMap((skill) => {
      if (typeof skill.name !== 'string' || typeof skill.description !== 'string') return []
      const iface =
        skill.interface && typeof skill.interface === 'object'
          ? (skill.interface as Record<string, unknown>)
          : null
      const handle = randomUUID()
      if (typeof skill.path !== 'string' || !isInside(this.mirroredSkillsRoot, skill.path))
        return []
      this.skillHandles.set(handle, {
        guestId,
        expiresAt: Date.now() + 300_000,
        name: skill.name,
        path: skill.path,
      })
      return [
        {
          handle,
          name: skill.name,
          displayName: typeof iface?.displayName === 'string' ? iface.displayName : skill.name,
          description: skill.description,
          scope: typeof skill.scope === 'string' ? skill.scope : 'user',
        },
      ]
    })
  }

  validateSkillHandles(guestId: string, handles: readonly string[]) {
    const now = Date.now()
    for (const [handle, entry] of this.skillHandles) {
      if (entry.expiresAt <= now) this.skillHandles.delete(handle)
    }
    return handles.every((handle) => this.skillHandles.get(handle)?.guestId === guestId)
  }

  private skillInput(guestId: string, text: string, handles: readonly string[]) {
    if (!this.validateSkillHandles(guestId, handles))
      throw new Error('Selected guest skills are unavailable')
    const skills = handles.map((handle) => this.skillHandles.get(handle)!)
    return [
      {
        type: 'text',
        text: skills.length
          ? `${skills.map((skill) => `$${skill.name}`).join(' ')}\n${text}`
          : text,
      },
      ...skills.map((skill) => ({ type: 'skill', name: skill.name, path: skill.path })),
    ]
  }

  async removeWorkspace(guestPublicId: string) {
    const workspace = this.resolveGuestWorkspace(guestPublicId)
    await rm(workspace, {
      recursive: true,
      force: true,
    })
  }

  private resolveGuestWorkspace(guestPublicId: string) {
    const root = path.resolve(this.config.dataRoot, 'guest', 'workspaces')
    if (!/^[0-9a-f-]{36}$/i.test(guestPublicId))
      throw new Error('Guest workspace identity is invalid')
    const workspace = path.resolve(root, guestPublicId)
    const relative = path.relative(root, workspace)
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Guest workspace path is invalid')
    return workspace
  }

  private async startProcess(): Promise<GuestInstance> {
    const home = path.resolve(this.config.dataRoot, 'guest', '.codex')
    log.info('Guest runtime preparing isolated CODEX_HOME')
    await mkdir(home, { recursive: true })
    const configPath = path.join(home, 'config.toml')
    const provider = JSON.stringify(this.guest.provider)
    let existingConfig = ''
    try {
      existingConfig = await readFile(configPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const windowsConfig = extractWindowsConfig(existingConfig)
    const configLines = [
      `model_provider = ${provider}`,
      '',
      `[model_providers.${this.guest.provider}]`,
      `name = ${provider}`,
      `base_url = ${JSON.stringify(this.guest.baseUrl)}`,
      'wire_api = "responses"',
      'requires_openai_auth = true',
      '',
      'web_search = "live"',
      '',
      '[tools.web_search]',
    ]
    if (windowsConfig) configLines.push('', windowsConfig)
    await writeFile(configPath, `${configLines.join('\n')}\n`, { mode: 0o600 })
    log.info('Guest runtime resolving verified App Server command')
    const command = await this.runtime.resolveCommand()
    const transport = this.transportFactory(command, {
      cwd: home,
      inheritEnv: false,
      env: guestProcessEnvironment(home),
    })
    const client = new CodexRpcClient(transport)
    client.onEvent((message) => {
      void this.onMessage?.(message)
    })
    client.onRequest((message) => {
      if (
        message.method === 'item/tool/requestUserInput' &&
        isSafeUserInputRequest(message.params)
      ) {
        if (typeof message.id !== 'number' && typeof message.id !== 'string') return
        const params = message.params as Record<string, unknown>
        this.pendingUserInput.set(message.id, {
          threadId: params.threadId as string,
          questionIds: new Set(
            (params.questions as Array<Record<string, unknown>>).map(
              (question) => question.id as string,
            ),
          ),
        })
        void this.onMessage?.(message)
        return
      }
      if (typeof message.id === 'number' || typeof message.id === 'string')
        client.respondError(message.id, { code: -32601, message: 'Guest request is not available' })
    })
    await startupStep('initialize', () => client.initialize())
    await startupStep('prepare skills', () => this.ensureSkillsMirrored())
    await startupStep('configure skills', () =>
      client.request('skills/extraRoots/set', { extraRoots: [this.mirroredSkillsRoot] }),
    )
    await startupStep('authenticate dedicated credential', () =>
      client.request('account/login/start', { type: 'apiKey', apiKey: this.guest.apiKey }),
    )
    const account = (await startupStep('verify account', () =>
      client.request('account/read', {}),
    )) as {
      account?: { type?: unknown }
      requiresOpenaiAuth?: unknown
    }
    if (account.account?.type !== 'apiKey' || account.requiresOpenaiAuth !== true)
      throw new Error('Guest credential verification failed')
    if (process.platform === 'win32') {
      const readiness = (await startupStep('verify Windows sandbox', () =>
        client.request('windowsSandbox/readiness', null),
      )) as { status?: unknown }
      if (readiness.status !== 'ready')
        throw new Error(
          `Windows sandbox is not ready (status=${describeUnknown(readiness.status ?? 'unknown')})`,
        )
    } else {
      log.info(`Guest runtime using ${process.platform} App Server sandbox`)
    }
    client.onClose(() => {
      if (this.status === 'ready') {
        this.status = 'failed'
        this.instance = null
      }
    })
    return { client, home }
  }

  private async ensureSkillsMirrored() {
    if (this.skillsMirrored) return
    await rm(this.mirroredSkillsRoot, { recursive: true, force: true })
    await mkdir(this.mirroredSkillsRoot, { recursive: true })
    for (const [index, source] of this.guest.skillRoots.entries()) {
      const root = path.resolve(source)
      const name = `root-${index}`
      await copySeedSafely(root, path.join(this.mirroredSkillsRoot, name))
    }
    this.skillsMirrored = true
  }
}

async function startupStep<T>(name: string, operation: () => Promise<T>) {
  log.info(`Guest runtime ${name}`)
  try {
    return await operation()
  } catch (error) {
    throw new Error(`Guest runtime ${name} failed`, { cause: error })
  }
}

function isSafeUserInputRequest(params: unknown) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false
  const value = params as Record<string, unknown>
  if (typeof value.threadId !== 'string' || typeof value.turnId !== 'string') return false
  if (!Array.isArray(value.questions) || value.questions.length > 3) return false
  return value.questions.every((question) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) return false
    const item = question as Record<string, unknown>
    return (
      typeof item.id === 'string' && typeof item.question === 'string' && item.isSecret !== true
    )
  })
}

function guestProcessEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CODEX_HOME: home }
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP']) {
    const value = process.env[name]
    if (value) environment[name] = value
  }
  return environment
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function normalizeUserInputAnswers(value: unknown, questionIds: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const answers =
    record.answers && typeof record.answers === 'object' && !Array.isArray(record.answers)
      ? record.answers
      : value
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null
  const normalized: Record<string, { answers: string[] }> = {}
  for (const [questionId, response] of Object.entries(answers)) {
    if (!questionIds.has(questionId) || !response || typeof response !== 'object') return null
    const values = (response as Record<string, unknown>).answers
    if (
      !Array.isArray(values) ||
      values.length > 10 ||
      !values.every((entry) => typeof entry === 'string' && entry.length <= 4_000)
    )
      return null
    normalized[questionId] = { answers: values }
  }
  return normalized
}

async function copySeedSafely(seedRoot: string, destination: string) {
  const seedStat = await lstat(seedRoot)
  if (!seedStat.isDirectory() || seedStat.isSymbolicLink())
    throw new Error('Guest mirror source is invalid')
  await mkdir(destination, { recursive: true })
  const walk = async (source: string, target: string) => {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name)
      const to = path.join(target, entry.name)
      const stat = await lstat(from)
      if (
        stat.isSymbolicLink() ||
        entry.isBlockDevice() ||
        entry.isCharacterDevice() ||
        entry.isFIFO() ||
        entry.isSocket()
      )
        throw new Error('Guest mirror source contains unsupported file type')
      if (stat.isDirectory()) {
        await mkdir(to, { recursive: true })
        await walk(from, to)
      } else if (stat.isFile()) {
        await cp(from, to, { force: true })
      } else throw new Error('Guest mirror source contains unsupported file type')
    }
  }
  await walk(seedRoot, destination)
}
