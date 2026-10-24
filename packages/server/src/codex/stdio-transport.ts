import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import process from 'node:process'
import { log, safeError } from '../logger.js'

export type JsonRpcMessage = Record<string, unknown>
export type CodexCommand = string | { executable: string; args?: string[] }
export type CodexProcessOptions = { cwd?: string; env?: NodeJS.ProcessEnv; inheritEnv?: boolean }

export function parseJsonRpcLine(line: string): JsonRpcMessage | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    return value as JsonRpcMessage
  } catch {
    return undefined
  }
}

export class CodexStdioTransport {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()
  private readonly exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >()
  private readonly stderrListeners = new Set<(line: string) => void>()
  private readonly stderrTail: string[] = []

  constructor(command: CodexCommand, options: CodexProcessOptions = {}) {
    const [executable, args] =
      typeof command === 'string'
        ? (() => {
            const [file, ...rest] = command.trim().split(/\s+/)
            return [file, rest] as const
          })()
        : ([command.executable, command.args ?? []] as const)
    if (!executable) throw new Error('Codex command cannot be empty')
    this.process = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...(options.inheritEnv === false ? {} : process.env), ...options.env },
      stdio: 'pipe',
      windowsHide: true,
    })
    log.info(`Codex App Server starting (${executable})`)
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      const message = parseJsonRpcLine(line)
      if (message) for (const listener of this.listeners) listener(message)
    })
    createInterface({ input: this.process.stderr }).on('line', (line) => {
      this.stderrTail.push(safeError(line))
      if (this.stderrTail.length > 8) this.stderrTail.shift()
      for (const listener of this.stderrListeners) listener(line)
    })
    this.process.on('error', (error) => {
      log.error(`Codex process failed to start: ${safeError(error)}`)
      for (const listener of this.errorListeners) listener(error)
    })
    this.process.on('exit', (code, signal) => {
      const detail = this.stderrTail.length ? `; stderr: ${this.stderrTail.join(' | ')}` : ''
      log.error(
        `Codex App Server exited with code=${code ?? 'null'} signal=${signal ?? 'none'}${detail}`,
      )
      for (const listener of this.exitListeners) listener(code, signal)
    })
  }
  onMessage(listener: (message: JsonRpcMessage) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  onError(listener: (error: Error) => void) {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }
  onStderr(listener: (line: string) => void) {
    this.stderrListeners.add(listener)
    return () => this.stderrListeners.delete(listener)
  }
  send(message: JsonRpcMessage) {
    if (!this.process.stdin.writable) throw new Error('Codex process stdin is unavailable')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }
  stop() {
    this.process.kill()
  }
}
