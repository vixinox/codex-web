import pino, { type Logger as PinoLogger } from 'pino'
import type { LogLevel } from '@codex-web/telemetry/logger'
import { createPinoLogger } from '@codex-web/telemetry/node'
import type { LogFields, Logger } from '@codex-web/telemetry/logger'

let activeLogger: Logger | undefined
let fastifyLogger: PinoLogger | undefined

export function createServerLogger(): Logger {
  const level = process.env.LOG_LEVEL?.trim().toLowerCase() || 'info'
  if (!['debug', 'info', 'warn', 'error'].includes(level)) throw new Error('Invalid LOG_LEVEL')
  const transport = process.stdout.isTTY
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', singleLine: true },
      })
    : undefined
  const sink = pino({ level }, transport)
  fastifyLogger = sink
  return createPinoLogger(sink as unknown as PinoLoggerAdapter, level as never)
}

export function getFastifyLogger(): PinoLogger {
  if (!fastifyLogger) createServerLogger()
  return fastifyLogger!
}

type PinoLoggerAdapter = {
  child(bindings: Record<string, unknown>): PinoLoggerAdapter
  debug(fields: Record<string, unknown>, message: string): void
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

export function setServerLogger(logger: Logger) {
  activeLogger = logger
}

export function getServerLogger(): Logger {
  if (!activeLogger) activeLogger = createServerLogger()
  return activeLogger
}

export const log = {
  debug: (event: string, fields?: LogFields, error?: unknown) =>
    safeWrite('debug', event, fields, error),
  info: (event: string, fields?: LogFields, error?: unknown) =>
    safeWrite('info', event, fields, error),
  warn: (event: string, fields?: LogFields, error?: unknown) =>
    safeWrite('warn', event, fields, error),
  error: (event: string, fields?: LogFields, error?: unknown) =>
    safeWrite('error', event, fields, error),
  success: (event: string, fields?: LogFields) => safeWrite('info', event, fields),
}

function safeWrite(level: LogLevel, event: string, fields?: LogFields, error?: unknown) {
  try {
    getServerLogger()[level](event, fields, error)
  } catch {
    // Logging must not affect Owner work or cleanup.
  }
}
