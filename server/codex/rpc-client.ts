import type { JsonRpcMessage } from './stdio-transport.js'

export type RpcTransport = {
  send(message: JsonRpcMessage): void
  stop(): void
  onMessage(listener: (message: JsonRpcMessage) => void): () => boolean
  onError(listener: (error: Error) => void): () => boolean
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => boolean
}

export class CodexRpcClient {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
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
    if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if ('error' in message) pending.reject(new Error(JSON.stringify(message.error)))
      else pending.resolve(message.result)
      return
    }
    if (typeof message.method === 'string' && typeof message.id === 'number') {
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
