import type { OwnerTransport } from './contracts.js'

export class VirtualOwnerTransport implements OwnerTransport {
  readonly kind = 'relay' as const
  pairedDeviceId: string
  readonly e2eeVerified = true
  clientPublicKey?: string
  promote?: (deviceId: string, clientToken: string) => void
  promoted = false
  enrollmentCandidate = false
  enrollmentReference?: string
  private readonly sendFrame: (frame: string | Uint8Array) => void
  private readonly closeTransport: (code?: number, reason?: string) => void
  private readonly messageListeners = new Set<(frame: string | Uint8Array) => void>()
  private readonly closeListeners = new Set<(reason?: string) => void>()
  private closed = false

  constructor(
    pairedDeviceId: string,
    send: (frame: string | Uint8Array) => void,
    close: (code?: number, reason?: string) => void,
  ) {
    this.pairedDeviceId = pairedDeviceId
    this.sendFrame = send
    this.closeTransport = close
  }

  send(frame: string | Uint8Array) {
    if (this.closed) return
    this.sendFrame(frame)
  }

  close(code?: number, reason?: string) {
    if (this.closed) return
    this.closed = true
    this.closeTransport(code, reason)
    for (const listener of this.closeListeners) listener(reason)
    this.messageListeners.clear()
    this.closeListeners.clear()
  }

  onMessage(listener: (frame: string | Uint8Array) => void) {
    if (this.closed) return () => undefined
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onClose(listener: (reason?: string) => void) {
    if (this.closed) {
      listener()
      return () => undefined
    }
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  receive(frame: string | Uint8Array) {
    if (this.closed) return
    for (const listener of this.messageListeners) listener(frame)
  }
}
