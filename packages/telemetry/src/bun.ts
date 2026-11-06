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

export function createBunLogger(
  options: { level?: LogLevel; fields?: LogFields; isTTY?: boolean } = {},
): Logger {
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY)
  return createLogger({
    level: options.level ?? parseLogLevel(process.env.LOG_LEVEL),
    fields: options.fields,
    sink: (record) => writeBun(record, isTTY),
    onSinkFailure: () => process.stderr.write('telemetry.logger.sink-failed\n'),
  })
}

function writeBun(record: LogRecord, isTTY: boolean) {
  const output = isTTY ? formatHumanLine(record) : formatJsonLine(record)
  const stream = record.level === 'error' ? process.stderr : process.stdout
  stream.write(`${output}\n`)
}
