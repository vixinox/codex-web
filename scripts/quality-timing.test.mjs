import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  evaluateTiming,
  environmentMatches,
  formatDuration,
  parseCommandNames,
  persistBaseline,
  persistReportHistory,
  requireCalibrationReason,
  runProcess,
} from './quality-timing.mjs'

test('quality timing parses the supported command set and rejects unknown commands', () => {
  assert.deepEqual(parseCommandNames('lint,test,lint'), ['lint', 'test'])
  assert.throws(() => parseCommandNames('lint,build'), /Unknown quality command: build/u)
})

test('quality timing blocks only at the absolute or combined relative threshold', () => {
  const baseline = { baselineMs: 10_000, absoluteLimitMs: 100_000 }
  assert.equal(evaluateTiming(14_999, baseline).blocked, false)
  assert.equal(evaluateTiming(15_001, baseline).blocked, true)
  assert.equal(evaluateTiming(15_000, baseline).blocked, false)
  assert.equal(evaluateTiming(20_000, baseline).blocked, true)
  assert.equal(evaluateTiming(2_501, { baselineMs: 1_000, absoluteLimitMs: 2_500 }).blocked, true)
})

test('quality timing compares the full environment identity', () => {
  const environment = { node: 'v24', platform: 'win32', arch: 'x64' }
  assert.equal(environmentMatches(environment, { ...environment }), true)
  assert.equal(environmentMatches(environment, { ...environment, arch: 'arm64' }), false)
})

test('quality timing formats durations for human reports', () => {
  assert.equal(formatDuration(12_345), '12.35s')
})

test('quality timing requires a stated reason before calibrating', () => {
  assert.throws(() => requireCalibrationReason(undefined), /requires --reason/u)
  assert.equal(requireCalibrationReason('  upgrade local CPU  '), 'upgrade local CPU')
})

test('quality timing measures child process wall time and preserves its exit code', async () => {
  const success = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 25)'], {
    stdio: 'ignore',
  })
  assert.equal(success.exitCode, 0)
  assert.ok(success.durationMs >= 20)

  const failure = await runProcess(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' })
  assert.equal(failure.exitCode, 7)
  assert.ok(failure.durationMs >= 0)
})

test('quality timing preserves an existing baseline when atomic replacement fails', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'quality-baseline-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const baselinePath = join(root, 'baseline.json')
  mkdirSync(baselinePath)
  assert.throws(() => persistBaseline(baselinePath, { schemaVersion: 1 }))
  assert.equal(existsSync(baselinePath), true)
  assert.equal(readdirSync(root).length, 1)
})

test('quality timing keeps only the latest report and twenty dated reports', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'quality-report-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  for (let timestamp = 1; timestamp <= 21; timestamp += 1)
    persistReportHistory(root, { mode: 'check', timestamp }, timestamp)
  const reports = readdirSync(root).filter((name) => name.endsWith('.json'))
  assert.equal(reports.length, 21)
  assert.equal(reports.includes('1-check.json'), false)
  assert.equal(reports.includes('21-check.json'), true)
  assert.equal(JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8')).timestamp, 21)
})
