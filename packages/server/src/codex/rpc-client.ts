import type { JsonRpcMessage } from './stdio-transport.js'
import { log } from '../logger.js'
import { formatRpcMessageId, summarizeRpcShape } from './rpc-message-summary.js'

export type RpcTransport = {
  send(message: JsonRpcMessage): void
  stop(): void
  onMessage(listener: (message: JsonRpcMessage) => void): () => boolean
  onError(listener: (error: Error) => void): () => boolean
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => boolean
}

export class CodexRpcClient {
  private nextId = 1
  private receiveSequence = 0
  private readonly pending = new Map<
    number | string,
    { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private readonly eventListeners = new Set<(message: JsonRpcMessage) => void>()
  private readonly requestListeners = new Set<(message: JsonRpcMessage) => void>()
  private readonly closeListeners = new Set<(error: Error) => void>()
  private closed = false
  private readonly transport: RpcTransport

  constructor(transport: RpcTransport) {
    this.transport = transport
    transport.onMessage((message) => this.receive(message))
    transport.onError((error) => this.fail(error))
    transport.onExit((code, signal) =>
      this.fail(new Error(`Codex process exited (${code ?? signal ?? 'unknown'})`)),
    )
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'codex_web', title: 'Codex Web', version: '0.0.1' },
      capabilities: { experimentalApi: true },
    })
    this.notify('initialized', {})
  }

  request(
    method: string,
    params: Record<string, unknown> | null = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex RPC client is closed'))
    if (signal?.aborted)
      return Promise.reject(
        signal.reason instanceof Error ? signal.reason : new Error('Codex RPC request aborted'),
      )
    const id = this.nextId++
    const response = new Promise<unknown>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id)
        reject(
          signal?.reason instanceof Error ? signal.reason : new Error('Codex RPC request aborted'),
        )
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(id, {
        method,
        resolve: (value) => {
          signal?.removeEventListener('abort', abort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort)
          reject(error)
        },
      })
    })
    this.transport.send({ method, id, params })
    return response
  }

  notify(method: string, params: Record<string, unknown>) {
    if (this.closed) throw new Error('Codex RPC client is closed')
    this.transport.send({ method, params })
  }

  onEvent(listener: (message: JsonRpcMessage) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onRequest(listener: (message: JsonRpcMessage) => void) {
    this.requestListeners.add(listener)
    return () => this.requestListeners.delete(listener)
  }

  respond(id: number | string, result: unknown) {
    if (this.closed) throw new Error('Codex RPC client is closed')
    this.transport.send({ id, result })
  }

  respondError(id: number | string, error: { code: number; message: string; data?: unknown }) {
    if (this.closed) throw new Error('Codex RPC client is closed')
    this.transport.send({ id, error })
  }

  onClose(listener: (error: Error) => void) {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  stop() {
    this.fail(new Error('Codex RPC client stopped'))
    this.transport.stop()
  }

  private receive(message: JsonRpcMessage) {
    const sequence = ++this.receiveSequence
    const requestId = message.id
    const pending = isRequestId(requestId) ? this.pending.get(requestId) : undefined
    const hasResponse = isRequestId(requestId) && ('result' in message || 'error' in message)
    const isServerRequest = typeof message.method === 'string' && isRequestId(requestId)
    const direction = hasResponse
      ? 'response'
      : isServerRequest
        ? 'server-request'
        : typeof message.method === 'string'
          ? 'notification'
          : 'unclassified'
    const method =
      typeof message.method === 'string'
        ? message.method.replace(/[^A-Za-z0-9._/-]/gu, '?').slice(0, 80)
        : (pending?.method ?? (hasResponse ? 'unmatched-response' : 'unknown'))
    const shape = hasResponse
      ? 'error' in message
        ? summarizeRpcShape(message.error)
        : summarizeRpcShape(message.result)
      : 'params' in message
        ? summarizeRpcShape(message.params)
        : summarizeRpcShape(message)
    log.info('codex.rpc.message', {
      direction,
      sequence,
      method,
      id: formatRpcMessageId(requestId),
      shape: String(shape).slice(0, 120),
    })

    if (isRequestId(message.id) && ('result' in message || 'error' in message)) {
      if (!pending) return
      this.pending.delete(message.id)
      if ('error' in message) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (typeof message.method === 'string' && isRequestId(message.id)) {
      for (const listener of this.requestListeners) listener(message)
    } else for (const listener of this.eventListeners) listener(message)
  }

  private fail(error: Error) {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const listener of this.closeListeners) listener(error)
    this.closeListeners.clear()
  }
}

function isRequestId(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}
