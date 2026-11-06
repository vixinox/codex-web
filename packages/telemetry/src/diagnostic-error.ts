import type { LogLevel } from './logger.js'

export type DiagnosticErrorOptions = ErrorOptions & {
  level?: LogLevel
  retryable?: boolean
}

export class DiagnosticError extends Error {
  readonly code: string
  readonly level: LogLevel
  readonly retryable: boolean

  constructor(code: string, options: DiagnosticErrorOptions = {}) {
    super(code, options)
    this.name = 'DiagnosticError'
    this.code = code
    this.level = options.level ?? 'error'
    this.retryable = options.retryable ?? false
  }
}
