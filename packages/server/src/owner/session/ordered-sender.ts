import type { OwnerTransport } from './contracts.js'

/** Owns the ordered delivery queue and its byte capacity for one Owner connection. */
export class OrderedOwnerSender {
  private queue: Promise<void> = Promise.resolve()
  private queuedBytes = 0
  private closed = false
  private readonly transport: Pick<OwnerTransport, 'send'>
  private readonly maxQueuedBytes: number
  private readonly fail: (code: number, reason: string) => void
  constructor(
    transport: Pick<OwnerTransport, 'send'>,
    maxQueuedBytes: number,
    fail: (code: number, reason: string) => void,
  ) {
    this.transport = transport
    this.maxQueuedBytes = maxQueuedBytes
    this.fail = fail
  }
  async send(encoded: string, bytes: number): Promise<void> {
    if (this.closed) return
    if (this.queuedBytes + bytes > this.maxQueuedBytes) {
      this.fail(1013, 'BACKPRESSURE_LIMIT_EXCEEDED')
      return
    }
    this.queuedBytes += bytes
    const queued = this.queue
      .then(() => (this.closed ? undefined : this.transport.send(encoded)))
      .catch(() => this.fail(1011, 'SEND_FAILED'))
      .finally(() => {
        this.queuedBytes -= bytes
      })
    this.queue = queued
    await queued
  }
  close() {
    this.closed = true
  }
}
