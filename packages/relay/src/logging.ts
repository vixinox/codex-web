import type { Logger, LogFields, LogLevel } from '@codex-web/telemetry/logger'

const noop = () => undefined

export const nullRelayLogger: Logger = {
  child: () => nullRelayLogger,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
}

/**
 * Bun's stdout/stderr and injected test sinks can fail synchronously. Relay callbacks must still
 * finish routing cleanup, so logging is isolated behind this best-effort wrapper.
 */
export function containRelayLogger(logger: Logger): Logger {
  const safeCall = (level: LogLevel, event: string, fields?: LogFields, error?: unknown) => {
    try {
      logger[level](event, fields, error)
    } catch {
      try {
        process.stderr.write('relay.logging.sink-failed\n')
      } catch {
        // The emergency sink is deliberately minimal and cannot affect relay work either.
      }
    }
  }

  return {
    child(fields) {
      try {
        return containRelayLogger(logger.child(fields))
      } catch {
        try {
          process.stderr.write('relay.logging.sink-failed\n')
        } catch {
          // Ignore emergency sink failures.
        }
        return nullRelayLogger
      }
    },
    debug: (event, fields, error) => safeCall('debug', event, fields, error),
    info: (event, fields, error) => safeCall('info', event, fields, error),
    warn: (event, fields, error) => safeCall('warn', event, fields, error),
    error: (event, fields, error) => safeCall('error', event, fields, error),
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/u

export function safeRelayIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : undefined
}
