import assert from 'node:assert/strict'
import test from 'node:test'

import { createNodeLogger, createPinoLogger, type PinoLike } from './node.js'

test('Node logger reads LOG_LEVEL when no explicit level is provided', () => {
  const previousLevel = process.env.LOG_LEVEL
  const previousStdoutWrite = process.stdout.write
  const previousStderrWrite = process.stderr.write
  const stdoutLines: string[] = []
  const stderrLines: string[] = []
  process.env.LOG_LEVEL = 'error'
  process.stdout.write = ((chunk: string) => {
    stdoutLines.push(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string) => {
    stderrLines.push(chunk)
    return true
  }) as typeof process.stderr.write

  try {
    const logger = createNodeLogger({ isTTY: false })
    logger.warn('suppressed')
    logger.error('kept')
  } finally {
    if (previousLevel === undefined) delete process.env.LOG_LEVEL
    else process.env.LOG_LEVEL = previousLevel
    process.stdout.write = previousStdoutWrite
    process.stderr.write = previousStderrWrite
  }

  assert.deepEqual(stdoutLines, [])
  assert.equal(JSON.parse(stderrLines[0] ?? '{}').event, 'kept')
})

test('Pino adapter emits structured fields and normalized errors', () => {
  const written: Array<{ level: string; fields: Record<string, unknown>; message: string }> = []
  const makeLogger = (bindings: Record<string, unknown> = {}): PinoLike => ({
    child: (fields) => makeLogger({ ...bindings, ...fields }),
    debug: (fields, message) =>
      written.push({ level: 'debug', fields: { ...bindings, ...fields }, message }),
    info: (fields, message) =>
      written.push({ level: 'info', fields: { ...bindings, ...fields }, message }),
    warn: (fields, message) =>
      written.push({ level: 'warn', fields: { ...bindings, ...fields }, message }),
    error: (fields, message) =>
      written.push({ level: 'error', fields: { ...bindings, ...fields }, message }),
  })
  const logger = createPinoLogger(makeLogger(), 'debug').child({ service: 'server' })
  logger.error('http.request.failed', { statusCode: 500 }, new Error('failed'))

  assert.equal(written[0]?.message, 'http.request.failed')
  assert.equal(written[0]?.level, 'error')
  assert.deepEqual(written[0]?.fields.service, 'server')
  assert.deepEqual(written[0]?.fields.statusCode, 500)
  assert.equal((written[0]?.fields.err as { message: string }).message, 'failed')
})
