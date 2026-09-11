import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

test('exits after a database readiness failure', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'codex-web-db-start-'))
  const tsxCli = resolve('node_modules/tsx/dist/cli.mjs')
  const withPort = resolve('scripts/with-port.mjs')
  const stderr: Buffer[] = []

  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveResult, reject) => {
        const child = spawn(
          process.execPath,
          [withPort, '0', process.execPath, tsxCli, 'server/owner/server.ts'],
          {
            env: {
              ...process.env,
              NODE_ENV: 'test',
              BETTER_AUTH_SECRET: '12345678901234567890123456789012',
              BETTER_AUTH_URL: 'http://127.0.0.1:3000',
              DATABASE_URL: 'postgresql://bad:bad@127.0.0.1:1/bad',
              CODEX_DATA_ROOT: dataRoot,
              CODEX_EXIT_ON_SERVER_STARTUP_FAILURE: 'true',
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
          },
        )

        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        child.on('error', reject)

        const timer = setTimeout(() => {
          child.kill()
          reject(new Error('server startup process stayed alive after database readiness failure'))
        }, 5_000)

        child.on('exit', (code, signal) => {
          clearTimeout(timer)
          resolveResult({ code, signal })
        })
      },
    )

    const output = Buffer.concat(stderr).toString('utf8')
    assert.equal(result.code, 1)
    assert.equal(result.signal, null)
    assert.match(output, /Owner server failed to start: connect ECONNREFUSED/)
    assert.doesNotMatch(output, /Fastify listening at/)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
