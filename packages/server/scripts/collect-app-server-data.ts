import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import dotenv from 'dotenv'

type RpcMessage = Record<string, unknown>
type Scenario = {
  name: string
  status: 'observed' | 'not-observed' | 'failed'
  methods: string[]
  detail?: string
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: path.join(root, '.env'), quiet: true })

const baseUrl = requiredEnv('TEST_BASE_URL')
const apiKey = requiredEnv('TEST_API_KEY')
const model = requiredEnv('TEST_MODEL')
const reasoningEffort = requiredEnv('TEST_MODEL_REASONING_EFFORT')
const manifestPath = path.join(root, '.data/codex/runtime/manifest.json')
const manifest = existsSync(manifestPath)
  ? (JSON.parse(await readFile(manifestPath, 'utf8')) as {
      active?: { executablePath?: string; version?: string }
    })
  : {}
const executable =
  process.env.APP_SERVER_CAPTURE_EXECUTABLE?.trim() || manifest.active?.executablePath
const version = process.env.APP_SERVER_CAPTURE_VERSION?.trim() || manifest.active?.version
if (!executable || !version || !existsSync(executable))
  throw new Error('Verified App Server runtime is unavailable')

const runId =
  process.env.APP_SERVER_CAPTURE_RUN_ID?.trim() ||
  `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
const captureRoot = path.resolve(root, '.data', 'app-server-captures')
const outputDir = path.resolve(captureRoot, runId)
if (!outputDir.startsWith(`${captureRoot}${path.sep}`)) throw new Error('Capture run id is invalid')
const home = path.join(outputDir, 'codex-home')
const workspace = path.join(outputDir, 'workspace')
await mkdir(home, { recursive: true })
await mkdir(workspace, { recursive: true })
await writeFile(
  path.join(home, 'config.toml'),
  [
    'model_provider = "capture_test"',
    '',
    '[model_providers.capture_test]',
    'name = "capture_test"',
    `base_url = ${JSON.stringify(baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    '',
    'web_search = "live"',
    '',
  ].join('\n'),
  { mode: 0o600 },
)

const eventsFile = createWriteStream(path.join(outputDir, 'messages.jsonl'), { flags: 'wx' })
const scenarios: Scenario[] = []
const observedMethods = new Set<string>()
let sequence = 0
let nextId = 1
let stopped = false
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()
const requestMethods = new Map<number, string>()
const eventListeners = new Set<(message: RpcMessage) => void>()
const requestListeners = new Set<(message: RpcMessage) => void>()
const childArgs = process.env.APP_SERVER_CAPTURE_ARGS_JSON
  ? (JSON.parse(process.env.APP_SERVER_CAPTURE_ARGS_JSON) as string[])
  : ['--listen', 'stdio://']
const child: ChildProcessWithoutNullStreams = spawn(executable, childArgs, {
  cwd: workspace,
  env: sanitizedChildEnv(home),
  stdio: 'pipe',
  windowsHide: true,
})
child.stderr.resume()

function record(direction: string, message: RpcMessage, method?: string) {
  eventsFile.write(
    `${JSON.stringify({ sequence: ++sequence, at: new Date().toISOString(), direction, ...(method ? { method } : {}), message })}\n`,
  )
}

function send(message: RpcMessage) {
  if (!child.stdin.writable) throw new Error('App Server input is closed')
  child.stdin.write(`${JSON.stringify(message)}\n`)
  if (message.method !== 'account/login/start') {
    if (typeof message.method === 'string') observedMethods.add(message.method)
    record('client', message)
  }
}

function request(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<unknown> {
  const id = nextId++
  const result = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Timed out waiting for ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
  })
  requestMethods.set(id, method)
  send({ method, id, params })
  return result
}

function respond(message: RpcMessage, result: unknown) {
  const id = message.id
  if (typeof id !== 'number' && typeof id !== 'string') return
  send({ id, result })
  record(
    'client-response',
    { id, result },
    typeof message.method === 'string' ? message.method : undefined,
  )
}

function failAll(error: Error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(error)
  }
  pending.clear()
}

createInterface({ input: child.stdout }).on('line', (line) => {
  let message: RpcMessage
  try {
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    message = parsed as RpcMessage
  } catch {
    return
  }
  const id = message.id
  const isResponse =
    (typeof id === 'number' || typeof id === 'string') &&
    ('result' in message || 'error' in message)
  if (isResponse) {
    const responseMethod = typeof id === 'number' ? requestMethods.get(id) : undefined
    if (responseMethod !== 'account/login/start') record('server-response', message, responseMethod)
    const entry = typeof id === 'number' ? pending.get(id) : undefined
    if (entry) {
      pending.delete(id as number)
      clearTimeout(entry.timer)
      requestMethods.delete(id as number)
      if ('error' in message)
        entry.reject(new Error(`App Server request failed: ${responseMethod ?? 'unknown method'}`))
      else entry.resolve(message.result)
    }
    return
  }
  record(
    typeof message.method === 'string' && id !== undefined
      ? 'server-request'
      : 'server-notification',
    message,
    typeof message.method === 'string' ? message.method : undefined,
  )
  if (typeof message.method === 'string') observedMethods.add(message.method)
  if (typeof message.method === 'string' && id !== undefined) {
    for (const listener of requestListeners) listener(message)
  } else for (const listener of eventListeners) listener(message)
})
child.on('error', (error) => failAll(new Error(`Unable to start App Server (${error.name})`)))
child.on('exit', (code) => {
  if (!stopped) failAll(new Error(`App Server exited (${code ?? 'unknown'})`))
})

function onEvent(listener: (message: RpcMessage) => void) {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}
function onRequest(listener: (message: RpcMessage) => void) {
  requestListeners.add(listener)
  return () => requestListeners.delete(listener)
}

onRequest((message) => {
  if (
    typeof message.method !== 'string' ||
    (typeof message.id !== 'number' && typeof message.id !== 'string')
  )
    return
  if (message.method === 'item/commandExecution/requestApproval') {
    respond(message, { decision: 'decline' })
    return
  }
  if (message.method === 'item/fileChange/requestApproval') {
    respond(message, { decision: 'decline' })
    return
  }
  if (message.method === 'item/tool/requestUserInput') {
    respond(message, { answers: {} })
    return
  }
  respond(message, { decision: 'decline' })
})

function waitFor(timeoutMs: number) {
  return new Promise<RpcMessage[]>((resolve) => {
    const found: RpcMessage[] = []
    const timer = setTimeout(() => {
      off()
      resolve(found)
    }, timeoutMs)
    const off = onEvent((message) => {
      if (typeof message.method === 'string') found.push(message)
      if (message.method === 'turn/completed' || message.method === 'turn/failed') {
        clearTimeout(timer)
        off()
        resolve(found)
      }
    })
  })
}

async function runTurn(threadId: string, prompt: string, label: string, timeoutMs = 180_000) {
  const before = sequence
  let methods: string[] = []
  try {
    const terminal = waitFor(timeoutMs)
    await request(
      'turn/start',
      {
        threadId,
        input: [{ type: 'text', text: prompt }],
        model,
        effort: reasoningEffort,
        cwd: workspace,
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite' },
      },
      30_000,
    )
    methods = [
      ...new Set(
        (await terminal)
          .filter((event) => typeof event.method === 'string')
          .map((event) => String(event.method)),
      ),
    ]
    const status = methods.includes('turn/completed') ? 'observed' : 'failed'
    const found = scenarios.find((scenario) => scenario.name === label)
    if (found)
      Object.assign(found, {
        status,
        methods,
        ...(status === 'failed' ? { detail: 'Turn ended without turn/completed' } : {}),
      })
    else
      scenarios.push({
        name: label,
        status,
        methods,
        ...(status === 'failed' ? { detail: 'Turn ended without turn/completed' } : {}),
      })
  } catch (error) {
    scenarios.push({ name: label, status: 'failed', methods: [], detail: safeError(error) })
    throw error
  }
  return sequence - before
}

async function main() {
  await request('initialize', {
    clientInfo: {
      name: 'codex_web_data_collector',
      title: 'Codex Web Data Collector',
      version: '0.1.0',
    },
    capabilities: { experimentalApi: true },
  })
  send({ method: 'initialized', params: {} })
  await request('account/login/start', { type: 'apiKey', apiKey })
  await request('account/read', {})
  const threadResult = (await request('thread/start', {
    model,
    cwd: workspace,
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'workspaceWrite' },
  })) as { thread?: { id?: string } }
  const threadId = threadResult.thread?.id
  if (!threadId) throw new Error('App Server did not return a thread id')
  scenarios.push({ name: 'ordinary-streaming-chat', status: 'not-observed', methods: [] })
  await runTurn(
    threadId,
    'Reply with a short greeting and one sentence.',
    'ordinary-streaming-chat',
  )
  await runTurn(
    threadId,
    'List the files in the workspace and summarize them.',
    'command-and-tool-progress',
  )
  await runTurn(
    threadId,
    'Create a file named capture-sample.txt containing the exact text: sample captured.',
    'file-change',
  )
  await runTurn(
    threadId,
    'Make a brief plan to inspect the sample file, then do not modify it.',
    'plan',
  )
  await runTurn(
    threadId,
    'Ask me one clarifying question using your request-user-input tool if available; otherwise state that it is unavailable.',
    'user-input-request',
  )
  await runTurn(
    threadId,
    'Run a harmless command that requires explicit approval, such as printing a fixed word.',
    'approval-request',
  )
  const interruptRequest = request(
    'turn/start',
    {
      threadId,
      input: [{ type: 'text', text: 'Think carefully for a while, then give a concise answer.' }],
      model,
      effort: reasoningEffort,
      cwd: workspace,
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'workspaceWrite' },
    },
    30_000,
  )
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  try {
    await request('turn/interrupt', { threadId }, 15_000)
    await interruptRequest.catch(() => undefined)
    scenarios.push({ name: 'interrupt', status: 'observed', methods: ['turn/interrupt'] })
  } catch (error) {
    scenarios.push({ name: 'interrupt', status: 'failed', methods: [], detail: safeError(error) })
  }
  const read = await request('thread/read', { threadId, includeTurns: true })
  record('capture-annotation', {
    scenario: 'thread-read-snapshot',
    hasTurns: Boolean((read as { thread?: { turns?: unknown[] } })?.thread?.turns),
  })
  scenarios.push({ name: 'thread-read-snapshot', status: 'observed', methods: ['thread/read'] })
  await request('thread/resume', { threadId, cwd: workspace, model })
  scenarios.push({ name: 'resume', status: 'observed', methods: ['thread/resume'] })
  await runTurn(threadId, 'Continue with one short sentence.', 'multi-turn-after-resume')
  await runTurn(
    threadId,
    'Run /compact to compact this test conversation, then report when it is done.',
    'context-compaction',
    300_000,
  )
  const observed = observedMethods
  for (const scenario of scenarios) {
    if (scenario.name === 'thread-read-snapshot') observed.add('thread/read')
    if (scenario.name === 'resume') observed.add('thread/resume')
  }
  for (const [name, method] of [
    ['file-change', 'item/fileChange'],
    ['user-input-request', 'item/tool/requestUserInput'],
    ['approval-request', 'item/commandExecution/requestApproval'],
    ['plan', 'turn/plan/updated'],
    ['command-and-tool-progress', 'item/commandExecution/outputDelta'],
  ] as const) {
    const item = scenarios.find((scenario) => scenario.name === name)
    if (item && observed.has(method)) item.status = 'observed'
    else if (item) item.status = 'not-observed'
  }
  const methods = [...observed].sort()
  const report = {
    runId,
    capturedAt: new Date().toISOString(),
    appServerVersion: version,
    model,
    reasoningEffort,
    messageFile: 'messages.jsonl',
    scenarios,
    observedMethods: methods,
    notObservedMethods: scenarios
      .filter((item) => item.status === 'not-observed')
      .map((item) => item.name),
    assistantContentObserved: methods.some((method) =>
      ['item/agentMessage/delta', 'item/agentMessage', 'item/assistantMessage/delta'].includes(
        method,
      ),
    ),
  }
  await new Promise<void>((resolve, reject) =>
    eventsFile.end((error?: Error | null) => (error ? reject(error) : resolve())),
  )
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  })
  console.log(`Capture complete: ${path.relative(root, outputDir)}`)
  console.log(
    `App Server ${version}; ${sequence} messages; ${scenarios.filter((item) => item.status === 'observed').length}/${scenarios.length} scenarios observed.`,
  )
  console.log(`Observed methods: ${methods.join(', ')}`)
  console.log(`Not observed: ${report.notObservedMethods.join(', ') || 'none'}`)
}

function requiredEnv(key: string) {
  const value = process.env[key]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${key}`)
  return value
}
function sanitizedChildEnv(codexHome: string) {
  const env = { ...process.env }
  delete env.TEST_API_KEY
  delete env.OPENAI_API_KEY
  delete env.CODEX_API_KEY
  env.CODEX_HOME = codexHome
  return env
}
function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/https?:\/\/\S+/gu, '[endpoint]').slice(0, 240)
    : 'Unknown collection error'
}

try {
  await main()
} catch (error) {
  if (!eventsFile.closed) await new Promise<void>((resolve) => eventsFile.end(() => resolve()))
  console.error(safeError(error))
  process.exitCode = 1
} finally {
  stopped = true
  child.kill()
  if (child.exitCode === null && child.signalCode === null)
    await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  await rm(home, { recursive: true, force: true })
}
