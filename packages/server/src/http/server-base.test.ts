import assert from 'node:assert/strict'
import test from 'node:test'

import type { Logger, LogFields, LogLevel } from '@codex-web/telemetry/logger'
import { setServerLogger } from '../logger.js'
import { createHttpServer } from './server-base.js'

function captureLogger(
  records: Array<{ level: LogLevel; event: string; fields: LogFields }>,
): Logger {
  const logger: Logger = {
    child: () => logger,
    debug: (event, fields = {}) => records.push({ level: 'debug', event, fields }),
    info: (event, fields = {}) => records.push({ level: 'info', event, fields }),
    warn: (event, fields = {}) => records.push({ level: 'warn', event, fields }),
    error: (event, fields = {}) => records.push({ level: 'error', event, fields }),
  }
  return logger
}

test('HTTP response logs use the required level table and omit query strings', async () => {
  const records: Array<{ level: LogLevel; event: string; fields: LogFields }> = []
  setServerLogger(captureLogger(records))
  const app = await createHttpServer()
  app.get('/items/:id', async () => ({ ok: true }))
  try {
    await app.ready()
    await app.inject({ method: 'GET', url: '/items/123?token=secret' })
    const entries = records.filter((record) => record.event === 'http.response.completed')
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.level, 'info')
    assert.equal(entries[0]?.fields.route, '/items/:id')
    assert.equal(JSON.stringify(entries[0]?.fields).includes('secret'), false)
    await app.close()
  } finally {
    setServerLogger(captureLogger([]))
  }
})

test('5xx is logged once as an error while 4xx and 3xx are info', async () => {
  const records: Array<{ level: LogLevel; event: string; fields: LogFields }> = []
  setServerLogger(captureLogger(records))
  const app = await createHttpServer()
  app.get('/bad', async (_request, reply) => reply.redirect('/target'))
  app.get('/unavailable', async (_request, reply) => reply.status(503).send({ ok: false }))
  app.get('/broken', async () => {
    throw new Error('private failure')
  })
  try {
    await app.ready()
    await app.inject({ method: 'GET', url: '/missing' })
    await app.inject({ method: 'GET', url: '/bad' })
    await app.inject({ method: 'GET', url: '/broken' })
    await app.inject({ method: 'GET', url: '/unavailable' })
    const completed = records.filter((record) => record.event === 'http.response.completed')
    assert.deepEqual(
      completed.map((record) => record.level),
      ['info', 'info', 'info', 'error'],
    )
    assert.equal(records.filter((record) => record.event === 'http.request.failed').length, 1)
    assert.equal(JSON.stringify(records).includes('private failure'), false)
    await app.close()
  } finally {
    setServerLogger(captureLogger([]))
  }
})

test('origin rejection returns a safe error DTO', async () => {
  const app = await createHttpServer({
    enforceOriginChecks: true,
    trustedOrigins: ['https://allowed.example'],
  })
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/probe?secret=hidden',
      headers: { origin: 'https://denied.example' },
    })
    assert.equal(response.statusCode, 403)
    assert.deepEqual(response.json(), {
      error: {
        code: 'owner.auth.origin-not-allowed',
        message: 'This connection origin is not allowed.',
        retryable: false,
      },
    })
  } finally {
    await app.close()
  }
})
