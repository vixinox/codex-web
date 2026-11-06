import {
  createLogger,
  formatHumanLine,
  formatJsonLine,
  parseLogLevel,
  type LogFields,
  type Logger,
  type LogLevel,
  type LogRecord,
} from './logger.js'

export type PinoLike = {
  child(bindings: Record<string, unknown>): PinoLike
  debug(fields: Record<string, unknown>, message: string): void
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

export function createPinoLogger(
  pino: PinoLike,
  level = parseLogLevel(process.env.LOG_LEVEL),
): Logger {
  return createLogger({
    level,
    sink: (record) => writePino(pino, record),
    onSinkFailure: () => process.stderr.write('telemetry.logger.sink-failed\n'),
  })
}

function writePino(pino: PinoLike, record: LogRecord) {
  const child = pino.child(record.fields as Record<string, unknown>)
  const fields: Record<string, unknown> = { timestamp: record.timestamp }
  if (record.error) fields.err = record.error
  child[record.level](fields, record.event)
}

export function createNodeLogger(
  options: { level?: LogLevel; fields?: LogFields; isTTY?: boolean } = {},
): Logger {
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY)
  return createLogger({
    level: options.level ?? parseLogLevel(process.env.LOG_LEVEL),
    fields: options.fields,
    sink: (record) => writeNode(record, isTTY),
    onSinkFailure: () => process.stderr.write('telemetry.logger.sink-failed\n'),
  })
}

function writeNode(record: LogRecord, isTTY: boolean) {
  const output = isTTY ? formatHumanLine(record) : formatJsonLine(record)
  const stream = record.level === 'error' ? process.stderr : process.stdout
  stream.write(`${output}\n`)
}
