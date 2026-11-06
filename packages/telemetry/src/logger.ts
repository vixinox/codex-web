export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]
export type LogFieldValue = string | number | boolean | null
export type LogFields = Readonly<Record<string, LogFieldValue>>

export type NormalizedError = {
  name: string
  code?: string
  message?: string
  cause?: NormalizedError
}

export type LogRecord = {
  timestamp: string
  level: LogLevel
  event: string
  fields: LogFields
  error?: NormalizedError
}

export type LogSink = (record: LogRecord) => void

export type Logger = {
  child(fields: LogFields): Logger
  debug(event: string, fields?: LogFields, error?: unknown): void
  info(event: string, fields?: LogFields, error?: unknown): void
  warn(event: string, fields?: LogFields, error?: unknown): void
  error(event: string, fields?: LogFields, error?: unknown): void
}

export type CreateLoggerOptions = {
  sink: LogSink
  onSinkFailure?: () => void
  level?: LogLevel
  fields?: LogFields
  now?: () => Date
}

export function formatJsonLine(record: LogRecord): string {
  return JSON.stringify(record)
}

export function formatHumanLine(record: LogRecord): string {
  const fields = Object.entries(record.fields)
    .map(
      ([key, value]) =>
        `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`,
    )
    .join(' ')
  const error = record.error ? ` error=${JSON.stringify(record.error)}` : ''
  return `${record.timestamp} ${record.level.toUpperCase().padEnd(5)} ${record.event}${fields ? ` ${fields}` : ''}${error}`
}

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const SENSITIVE_KEY =
  /api[_-]?key|authorization|bearer|token|secret|password|private[_-]?key|path|cwd|workdir|directory/i

export function parseLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value.trim() === '') return 'info'
  const normalized = value.trim().toLowerCase()
  if (LOG_LEVELS.includes(normalized as LogLevel)) return normalized as LogLevel
  throw new Error(`Invalid LOG_LEVEL: ${sanitizeText(normalized)}`)
}

export function createLogger(options: CreateLoggerOptions): Logger {
  return createBoundLogger(options, options.fields ?? {})
}

export function normalizeError(
  error: unknown,
  depth = 0,
  seen = new Set<unknown>(),
): NormalizedError {
  if (depth >= 4 || error === null || error === undefined || seen.has(error))
    return { name: 'Error', message: '[cause omitted]' }
  seen.add(error)

  if (!(error instanceof Error)) return { name: 'NonErrorValue', message: typeof error }

  const code =
    'code' in error && typeof error.code === 'string' ? sanitizeText(error.code) : undefined
  const cause = error.cause
  return {
    name: sanitizeText(error.name || 'Error'),
    ...(code ? { code } : {}),
    ...(error.message ? { message: sanitizeText(error.message) } : {}),
    ...(cause !== undefined ? { cause: normalizeError(cause, depth + 1, seen) } : {}),
  }
}

export function sanitizeLogFields(fields: LogFields): LogFields {
  const safe: Record<string, LogFieldValue> = {}
  for (const [key, value] of Object.entries(fields)) {
    const safeKey = sanitizeText(key).slice(0, 64)
    safe[safeKey] = SENSITIVE_KEY.test(key)
      ? '[redacted]'
      : isLogFieldValue(value)
        ? typeof value === 'string'
          ? sanitizeText(value)
          : value
        : '[omitted]'
  }
  return safe
}

export function sanitizeText(value: string) {
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[redacted]')
    .replace(/(api[_-]?key|bearer|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z]:\\[^\r\n]*/g, '[path]')
    .replace(/(?:^|\s)(?:\/[^\s]+){2,}/g, ' [path]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
    .slice(0, 500)
}

function isLogFieldValue(value: unknown): value is LogFieldValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function createBoundLogger(options: CreateLoggerOptions, bindings: LogFields): Logger {
  const threshold = levelWeight[options.level ?? 'info']
  const write = (level: LogLevel, event: string, fields: LogFields = {}, error?: unknown) => {
    if (levelWeight[level] < threshold) return
    const merged = { ...bindings, ...fields }
    try {
      options.sink({
        timestamp: (options.now ?? (() => new Date()))().toISOString(),
        level,
        event: sanitizeText(event).slice(0, 120),
        fields: sanitizeLogFields(merged),
        ...(error === undefined ? {} : { error: normalizeError(error) }),
      })
    } catch {
      try {
        options.onSinkFailure?.()
      } catch {
        // A failed emergency fallback must never re-enter the logger or affect business flow.
      }
    }
  }
  return {
    child: (childFields) => createBoundLogger(options, { ...bindings, ...childFields }),
    debug: (event, fields, error) => write('debug', event, fields, error),
    info: (event, fields, error) => write('info', event, fields, error),
    warn: (event, fields, error) => write('warn', event, fields, error),
    error: (event, fields, error) => write('error', event, fields, error),
  }
}
