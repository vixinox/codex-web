import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, unlink, stat } from 'node:fs/promises'
import net, { type Server, type Socket } from 'node:net'
import path from 'node:path'

export const OWNER_IPC_VERSION = 1 as const
export const OWNER_IPC_MAX_FRAME_BYTES = 64 * 1024
export const OWNER_IPC_RETRY_MS = 5_000

export type OwnerIpcRequest = {
  version: typeof OWNER_IPC_VERSION
  requestId: string
  command: string
  params?: unknown
}

export type OwnerIpcResponse =
  | { version: typeof OWNER_IPC_VERSION; requestId: string; result: unknown }
  | {
      version: typeof OWNER_IPC_VERSION
      requestId: string
      error: { code: string; message: string; retryable: boolean }
    }

export type OwnerIpcDispatcher = (command: string, params: unknown) => Promise<unknown> | unknown

export function ownerIpcEndpoint(dataRoot: string) {
  const canonicalRoot = path.resolve(dataRoot).toLocaleLowerCase('en-US')
  const key = createHash('sha256').update(canonicalRoot).digest('hex').slice(0, 24)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\codex-web-owner-${key}`
    : path.join(dataRoot, `.owner-ipc-${key}.sock`)
}

export async function startOwnerIpcServer(
  dataRoot: string,
  dispatcher: OwnerIpcDispatcher,
  allowedCommands: ReadonlySet<string>,
) {
  const endpoint = ownerIpcEndpoint(dataRoot)
  if (process.platform !== 'win32') {
    await mkdir(path.dirname(endpoint), { recursive: true, mode: 0o700 })
    const existing = await stat(endpoint).then(
      () => true,
      () => false,
    )
    if (existing) {
      await new Promise<void>((resolve, reject) => {
        const probe = net.createConnection(endpoint)
        probe.once('connect', () => {
          probe.destroy()
          reject(new Error('OWNER_IPC_ALREADY_LISTENING'))
        })
        probe.once('error', async (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT') {
            reject(error)
            return
          }
          try {
            await unlink(endpoint)
            resolve()
          } catch (unlinkError) {
            reject(unlinkError)
          }
        })
      })
    }
  }

  const sockets = new Set<Socket>()
  let ready = false
  const server: Server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer) > OWNER_IPC_MAX_FRAME_BYTES) {
        socket.destroy()
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      if (newline !== buffer.length - 1 || buffer.indexOf('\n', newline + 1) !== -1) {
        socket.destroy()
        return
      }
      const line = buffer.slice(0, newline)
      buffer = ''
      void handleLine(line, socket, dispatcher, allowedCommands, () => ready)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  if (process.platform !== 'win32') await chmod(endpoint, 0o600)
  return {
    endpoint,
    markReady() {
      ready = true
    },
    async close() {
      ready = false
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      if (process.platform !== 'win32') await unlink(endpoint).catch(() => undefined)
    },
  }
}

export async function sendOwnerIpcRequest<T>(
  endpoint: string,
  command: string,
  params?: unknown,
  timeoutMs = 5_000,
): Promise<T> {
  const request: OwnerIpcRequest = {
    version: OWNER_IPC_VERSION,
    requestId: randomUUID(),
    command,
    ...(params === undefined ? {} : { params }),
  }
  const encoded = `${JSON.stringify(request)}\n`
  if (Buffer.byteLength(encoded) > OWNER_IPC_MAX_FRAME_BYTES)
    throw new Error('OWNER_IPC_FRAME_TOO_LARGE')
  return new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    let buffer = ''
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('OWNER_IPC_TIMEOUT'))
    }, timeoutMs)
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(encoded))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (Buffer.byteLength(buffer) > OWNER_IPC_MAX_FRAME_BYTES) {
        clearTimeout(timeout)
        socket.destroy()
        reject(new Error('OWNER_IPC_FRAME_TOO_LARGE'))
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as OwnerIpcResponse
        if (response.version !== OWNER_IPC_VERSION || response.requestId !== request.requestId)
          throw new Error('OWNER_IPC_INVALID_RESPONSE')
        if ('error' in response) throw new Error(response.error.code)
        clearTimeout(timeout)
        socket.end()
        resolve(response.result as T)
      } catch (error) {
        clearTimeout(timeout)
        socket.destroy()
        reject(error)
      }
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

export async function retryOwnerIpc<T>(action: () => Promise<T>, timeoutMs = OWNER_IPC_RETRY_MS) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  do {
    try {
      return await action()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } while (Date.now() < deadline)
  throw lastError ?? new Error('OWNER_IPC_NOT_READY')
}

async function handleLine(
  line: string,
  socket: Socket,
  dispatcher: OwnerIpcDispatcher,
  allowedCommands: ReadonlySet<string>,
  isReady: () => boolean,
) {
  let response: OwnerIpcResponse
  try {
    const raw: unknown = JSON.parse(line)
    if (
      !isRecord(raw) ||
      Object.keys(raw).some((key) => !['version', 'requestId', 'command', 'params'].includes(key))
    )
      throw new Error('INVALID_REQUEST')
    if (raw.version !== OWNER_IPC_VERSION) throw new Error('UNSUPPORTED_VERSION')
    if (typeof raw.requestId !== 'string' || raw.requestId.length > 128)
      throw new Error('INVALID_REQUEST')
    if (!isReady()) throw new Error('OWNER_NOT_READY')
    if (typeof raw.command !== 'string' || !allowedCommands.has(raw.command))
      throw new Error('COMMAND_NOT_ALLOWED')
    const result = await dispatcher(raw.command, raw.params)
    response = { version: OWNER_IPC_VERSION, requestId: raw.requestId, result }
  } catch (error) {
    response = {
      version: OWNER_IPC_VERSION,
      requestId: readRequestId(line),
      error: {
        code: error instanceof Error ? error.message : 'INTERNAL_ERROR',
        message: 'Owner local command failed.',
        retryable: error instanceof Error && error.message === 'OWNER_NOT_READY',
      },
    }
  }
  const encoded = `${JSON.stringify(response)}\n`
  if (Buffer.byteLength(encoded) <= OWNER_IPC_MAX_FRAME_BYTES) socket.end(encoded)
  else socket.destroy()
}

function readRequestId(line: string) {
  try {
    const value: unknown = JSON.parse(line)
    return isRecord(value) && typeof value.requestId === 'string' ? value.requestId : 'invalid'
  } catch {
    return 'invalid'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
