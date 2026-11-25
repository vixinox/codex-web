export type OwnerTransport = {
  kind: 'local' | 'relay'
  origin?: string
  pairedDeviceId?: string
  e2eeVerified?: boolean
  enrollmentCandidate?: boolean
  enrollmentReference?: string
  clientPublicKey?: string
  promote?: (deviceId: string, clientToken: string) => void
  promoted?: boolean
  send(frame: string | Uint8Array): Promise<void> | void
  close(code?: number, reason?: string): void
  onMessage(listener: (frame: string | Uint8Array) => void): () => void
  onClose(listener: (reason?: string) => void): () => void
}

export type OwnerContext = {
  ownerId: string
  sessionId: string
  sessionToken?: string
  stepUpAt?: number
  clientId: string
  connectionId: string
  transport: { kind: OwnerTransport['kind']; pairedDeviceId?: string }
}

export type OwnerAdmission = {
  ownerId: string
  sessionId: string
  sessionToken?: string
  stepUpAt?: number
}

export type OwnerStream = {
  meta?: unknown
  run(emit: (event: unknown) => Promise<void>, signal: AbortSignal): Promise<void> | void
}

export type OwnerStreamResult = {
  result?: unknown
  stream: OwnerStream
}

export type OwnerMethodContext = {
  readonly owner: OwnerContext | null
  readonly connectionId: string
  readonly transport: OwnerTransport
  readonly signal: AbortSignal
  readonly requestId: string
  authenticate(admission: OwnerAdmission): Promise<void> | void
  unauthenticate(): void
}

export type OwnerMethodDefinition = {
  access: 'public' | 'local' | 'authenticated'
  timeoutMs?: number
  closeAfterResponse?: boolean
  handle(params: unknown, context: OwnerMethodContext): unknown
}

export type OwnerMethodRegistry = ReadonlyMap<string, OwnerMethodDefinition>

export type OwnerSessionRuntimeOptions = {
  connectionId: string
  capabilities?: string[]
  localAdmission?: OwnerAdmission
  maxInFlightRequests?: number
  maxQueuedBytes?: number
  defaultRequestTimeoutMs?: number
  resumeSession?: (token: string, transport: OwnerTransport) => Promise<OwnerAdmission | null>
}
