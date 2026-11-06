import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import process from 'node:process'
import { log } from '../logger.js'

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
    log.info('codex.process.starting', { commandKind: typeof command })
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      const message = parseJsonRpcLine(line)
      if (message) for (const listener of this.listeners) listener(message)
    })
    createInterface({ input: this.process.stderr }).on('line', (line) => {
      this.stderrTail.push(String(line.length))
      if (this.stderrTail.length > 8) this.stderrTail.shift()
      for (const listener of this.stderrListeners) listener(line)
    })
    this.process.on('error', (error) => {
      log.error('codex.process.start-failed', {
        errorType: error.name.replace(/[^A-Za-z0-9]/gu, '').slice(0, 48),
      })
      for (const listener of this.errorListeners) listener(error)
    })
    this.process.on('exit', (code, signal) => {
      log.error('codex.process.exited', {
        exitCode: code,
        signal: signal ?? 'none',
        stderrLines: this.stderrTail.length,
        stderrBytes: this.stderrTail.reduce((total, length) => total + Number(length), 0),
      })
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
