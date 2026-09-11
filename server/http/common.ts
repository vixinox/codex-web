import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyReply, FastifyRequest } from 'fastify'

import type { Auth } from '../auth.js'
import { describeUnknown, log, safeError } from '../logger.js'
import type { ThreadAccessResult } from '../thread-access.js'

export type SseResponse = {
  write: (chunk: string) => boolean
  on?: (event: 'close' | 'error', listener: () => void) => unknown
  once: (event: 'drain', listener: () => void) => unknown
  removeListener: (event: 'drain', listener: () => void) => unknown
  destroy?: () => unknown
  destroyed?: boolean
  writableEnded?: boolean
}

export function apiError(code: string, message: string) {
  return { error: { code, message } }
}

export function codexFailure(reply: FastifyReply, error: unknown) {
  const runtimeError =
    error instanceof Error &&
    [
      'CODEX_RUNTIME_REQUIRED',
      'CODEX_RUNTIME_UNSUPPORTED',
      'CODEX_RUNTIME_VERIFICATION_FAILED',
      'CODEX_RUNTIME_ACTIVATION_FAILED',
    ].includes((error as Error & { code?: unknown }).code as string)
  const code =
    error instanceof Error && error.message === 'CODEX_START_REQUIRED'
      ? 'CODEX_START_REQUIRED'
      : runtimeError
        ? (error as Error & { code: string }).code
        : 'CODEX_UNAVAILABLE'
  return reply
    .status(code === 'CODEX_START_REQUIRED' || runtimeError ? 409 : 502)
    .send(
      apiError(
        code,
        code === 'CODEX_START_REQUIRED'
          ? 'Start Codex before using threads'
          : runtimeError
            ? error instanceof Error
              ? error.message
              : 'Codex runtime is unavailable'
            : 'Codex App Server unavailable',
      ),
    )
}

export function threadAccessFailure(
  reply: FastifyReply,
  result: Exclude<ThreadAccessResult, { kind: 'owned' }>,
) {
  if (result.kind === 'not_found')
    return reply.status(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'))
  if (result.kind === 'project_not_found')
    return reply.status(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'))
  if (result.kind === 'codex_start_required')
    return reply
      .status(409)
      .send(apiError('CODEX_START_REQUIRED', 'Start Codex before using threads'))
  if (result.kind === 'invalid_projection')
    return reply
      .status(502)
      .send(apiError('CODEX_PROTOCOL_ERROR', 'Codex returned an invalid thread'))
  return codexFailure(reply, result.error)
}

export const safeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9._:-]+$/.test(value)

export function parseEventCursor(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) || typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function resolveEventCursor(headerValue: unknown, queryValue: unknown) {
  const headerCursor = parseEventCursor(headerValue)
  if (headerCursor !== undefined) return headerCursor
  const queryCursor = parseEventCursor(queryValue)
  return queryCursor === null ? null : (queryCursor ?? 0)
}

export function authHeaders(request: FastifyRequest) {
  const headers = fromNodeHeaders(request.headers)
  headers.set('x-codex-web-client-ip', request.ip)
  return headers
}

async function forwardAuthResponse(response: Response, reply: FastifyReply) {
  reply.status(response.status)
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') reply.header(key, value)
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) reply.header('set-cookie', cookies)
  return reply.send(response.body ? await response.text() : null)
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply, auth: Auth) {
  const session = await auth.api.getSession({ headers: authHeaders(request) })
  if (!session) {
    await reply.status(401).send(apiError('UNAUTHORIZED', 'Authentication required'))
    return null
  }
  return session
}

export async function proxyAuthRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: Auth,
  authUrl: string,
) {
  const requestUrl = new URL(request.url, authUrl)
  const authRequest = new Request(requestUrl, {
    method: request.method,
    headers: authHeaders(request),
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  })
  return forwardAuthResponse(await auth.handler(authRequest), reply)
}

export function createSseWriter(response: SseResponse, maxQueuedFrames = 1_000) {
  let closed = false
  let blocked = false
  let drainListener: (() => void) | undefined
  const queue: string[] = []

  const cleanupDrainListener = () => {
    if (!drainListener) return
    response.removeListener('drain', drainListener)
    drainListener = undefined
  }

  const close = () => {
    if (closed) return
    closed = true
    queue.length = 0
    cleanupDrainListener()
  }

  const flush = () => {
    if (closed || blocked) return
    while (queue.length) {
      if (response.destroyed || response.writableEnded) {
        close()
        return
      }
      const writable = response.write(queue.shift()!)
      if (writable) continue
      blocked = true
      drainListener = () => {
        drainListener = undefined
        blocked = false
        flush()
      }
      response.once('drain', drainListener)
      return
    }
  }

  const write = (frame: string) => {
    if (closed) return false
    if (queue.length >= maxQueuedFrames) {
      close()
      response.destroy?.()
      return false
    }
    queue.push(frame)
    flush()
    return !blocked
  }

  return {
    write,
    close,
    get queuedFrames() {
      return queue.length
    },
    get blocked() {
      return blocked
    },
  }
}

export async function startSseStream(
  request: FastifyRequest,
  reply: FastifyReply,
  subscribe: (
    listener: (event: { id: number; message: Record<string, unknown> }) => void,
  ) => Promise<() => unknown> | (() => unknown),
) {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const writer = createSseWriter(reply.raw)
  writer.write(': connected\n\n')
  let closed = false
  let unsubscribe = () => undefined as unknown
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const cleanup = () => {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    writer.close()
    unsubscribe()
  }
  heartbeat = setInterval(() => {
    try {
      writer.write(': heartbeat\n\n')
    } catch {
      cleanup()
    }
  }, 15_000)
  request.raw.on('close', cleanup)
  reply.raw.on('close', cleanup)
  reply.raw.on('error', cleanup)
  const subscribed = await subscribe((event) => {
    try {
      writer.write(
        `id: ${event.id}\nevent: ${describeUnknown(event.message.method)}\ndata: ${JSON.stringify(event.message)}\n\n`,
      )
    } catch {
      cleanup()
    }
  })
  unsubscribe = subscribed
  if (closed) unsubscribe()
}

export function logHttpFailure(message: string, error: unknown) {
  log.error(`${message}: ${safeError(error)}`)
}
