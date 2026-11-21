import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const collector = path.join(root, 'packages/server/scripts/collect-app-server-data.ts')
const fakeServer = path.join(root, 'packages/server/scripts/fake-app-server-capture.ts')
const tsx = createRequire(import.meta.url).resolve('tsx/cli')

test('collector records RPC samples without persisting the API key', async () => {
  const runId = `test-${process.pid}-${Date.now()}`
  const temp = await mkdtemp(path.join(os.tmpdir(), 'app-server-capture-test-'))
  const output = path.join(root, '.data/app-server-captures', runId)
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [tsx, collector], {
          cwd: root,
          env: {
            ...process.env,
            TEST_BASE_URL: 'https://example.invalid/v1',
            TEST_API_KEY: 'capture-secret-should-not-persist',
            TEST_MODEL: 'capture-model',
            TEST_MODEL_REASONING_EFFORT: 'low',
            APP_SERVER_CAPTURE_EXECUTABLE: process.execPath,
            APP_SERVER_CAPTURE_VERSION: '0.0.1',
            APP_SERVER_CAPTURE_RUN_ID: runId,
            APP_SERVER_CAPTURE_ARGS_JSON: JSON.stringify([tsx, fakeServer]),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
        child.on('error', reject)
        child.on('exit', (code) => resolve({ code, stdout, stderr }))
      },
    )
    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stdout + result.stderr, /capture-secret-should-not-persist/)
    const messages = await readFile(path.join(output, 'messages.jsonl'), 'utf8')
    const report = await readFile(path.join(output, 'report.json'), 'utf8')
    assert.match(messages, /item\/agentMessage\/delta/)
    assert.match(messages, /thread\/read/)
    assert.doesNotMatch(messages, /capture-secret-should-not-persist/)
    assert.match(report, /ordinary-streaming-chat/)
    assert.match(report, /observedMethods/)
  } finally {
    await rm(output, { recursive: true, force: true })
    await rm(temp, { recursive: true, force: true })
  }
})
