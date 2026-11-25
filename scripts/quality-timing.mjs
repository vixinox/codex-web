import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

export const COMMANDS = {
  lint: 'pnpm lint',
  typecheck: 'pnpm typecheck',
  'test:tools': 'pnpm test:tools',
  'test:core': 'pnpm test:core',
  test: 'pnpm test',
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BASELINE_PATH = join(ROOT, 'quality', 'timing-baseline.json')
const REPORT_ROOT = join(ROOT, '.quality', 'reports')
const HISTORY_LIMIT = 20
const SAMPLE_COUNT = 3

export function parseCommandNames(value) {
  const names = (value ?? Object.keys(COMMANDS).join(','))
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const unknown = names.filter((name) => !COMMANDS[name])
  if (unknown.length > 0) throw new Error(`Unknown quality command: ${unknown.join(', ')}`)
  return [...new Set(names)]
}

export function currentEnvironment() {
  return {
    node: process.version,
    pnpm: process.env.npm_config_user_agent?.split('/')[1]?.split(' ')[0] ?? 'unknown',
    platform: process.platform,
    osPlatform: platform(),
    release: release(),
    arch: arch(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
  }
}

export function environmentMatches(expected, actual = currentEnvironment()) {
  return Object.keys(expected).every((key) => expected[key] === actual[key])
}

export function evaluateTiming(sampleMs, baseline) {
  const absolute = sampleMs > baseline.absoluteLimitMs
  const relative = sampleMs > baseline.baselineMs * 1.5 && sampleMs - baseline.baselineMs >= 5_000
  return {
    blocked: absolute || relative,
    absolute,
    relative,
    baselineMs: baseline.baselineMs,
    absoluteLimitMs: baseline.absoluteLimitMs,
  }
}

export function requireCalibrationReason(reason) {
  if (!reason?.trim()) throw new Error('Calibration requires --reason <text>')
  return reason.trim()
}

export function persistBaseline(path, baseline) {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(baseline, null, 2)}\n`)
    renameSync(temporaryPath, path)
  } catch (error) {
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

export function persistReportHistory(reportRoot, report, timestamp = Date.now()) {
  mkdirSync(reportRoot, { recursive: true })
  writeFileSync(join(reportRoot, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`)
  const mode = report.mode
  writeFileSync(
    join(reportRoot, `${timestamp}-${mode}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  const reports = readdirSync(reportRoot)
    .filter((entry) => /^\d+-(report|check|calibrate)\.json$/u.test(entry))
    .sort()
  for (const oldReport of reports.slice(0, Math.max(0, reports.length - HISTORY_LIMIT)))
    rmSync(join(reportRoot, oldReport), { force: true })
}

export function formatDuration(ms) {
  return `${(ms / 1000).toFixed(2)}s`
}

function commandParts(command) {
  return process.platform === 'win32'
    ? { executable: 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { executable: 'pnpm', args: command.slice(5).split(' ') }
}

export function runProcess(executable, args, options = {}) {
  return new Promise((resolve) => {
    const started = performance.now()
    const child = spawn(executable, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: false,
      ...options,
    })
    child.on('error', (error) =>
      resolve({ exitCode: 1, durationMs: performance.now() - started, error }),
    )
    child.on('exit', (code, signal) =>
      resolve({ exitCode: code ?? 1, signal, durationMs: performance.now() - started }),
    )
  })
}

async function runCommand(name) {
  const { executable, args } = commandParts(COMMANDS[name])
  process.stdout.write(`\n[quality] ${COMMANDS[name]}\n`)
  const result = await runProcess(executable, args)
  process.stdout.write(
    `[quality] ${name}: ${formatDuration(result.durationMs)} (exit ${result.exitCode})\n`,
  )
  return { name, command: COMMANDS[name], ...result }
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return undefined
  try {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    if (baseline.schemaVersion !== 1 || !baseline.environment || !baseline.commands)
      throw new Error('missing schemaVersion, environment, or commands')
    for (const name of Object.keys(COMMANDS)) {
      const entry = baseline.commands[name]
      if (!entry || !Number.isFinite(entry.baselineMs) || !Number.isFinite(entry.absoluteLimitMs))
        throw new Error(`invalid baseline for ${name}`)
    }
    return baseline
  } catch (error) {
    throw new Error(`Invalid quality timing baseline: ${error.message}`)
  }
}

function writeReport(results, mode, environment) {
  const report = {
    schemaVersion: 1,
    mode,
    recordedAt: new Date().toISOString(),
    environment,
    results: results.map(({ error, ...result }) => ({
      ...result,
      ...(error ? { error: error.message } : {}),
    })),
  }
  persistReportHistory(REPORT_ROOT, report)
}

function parseArgs(argv) {
  const args = { mode: 'report', commands: undefined, reason: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--mode') args.mode = argv[++index]
    else if (value === '--commands') args.commands = argv[++index]
    else if (value === '--reason') args.reason = argv[++index] ?? args.reason
    else throw new Error(`Unknown option: ${value}`)
  }
  if (!['report', 'check', 'calibrate'].includes(args.mode))
    throw new Error(`Unknown mode: ${args.mode}`)
  return args
}

async function calibrate(reason) {
  const calibrationReason = requireCalibrationReason(reason)
  const environment = currentEnvironment()
  const results = []
  const commands = {}
  for (const name of Object.keys(COMMANDS)) {
    process.stdout.write(`[quality] warming ${name}\n`)
    const warmup = await runCommand(name)
    results.push(warmup)
    if (warmup.exitCode !== 0) throw new Error(`Cannot calibrate ${name}: warmup failed`)
    const samples = []
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const result = await runCommand(name)
      results.push(result)
      if (result.exitCode !== 0) throw new Error(`Cannot calibrate ${name}: sample failed`)
      samples.push(result.durationMs)
    }
    samples.sort((left, right) => left - right)
    const baselineMs = samples[Math.floor(samples.length / 2)]
    commands[name] = {
      baselineMs: Math.round(baselineMs),
      absoluteLimitMs: Math.max(10_000, Math.ceil((baselineMs * 2) / 1_000) * 1_000),
      samplesMs: samples.map((sample) => Math.round(sample)),
    }
  }
  const baseline = {
    schemaVersion: 1,
    calibratedAt: new Date().toISOString(),
    reason: calibrationReason,
    environment,
    commands,
  }
  persistBaseline(BASELINE_PATH, baseline)
  writeReport(results, 'calibrate', environment)
  process.stdout.write(`[quality] wrote ${BASELINE_PATH}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const names = parseCommandNames(args.commands)
  if (args.mode === 'calibrate') return calibrate(args.reason)

  const baseline = readBaseline()
  const environment = currentEnvironment()
  if (!baseline && args.mode === 'check')
    throw new Error('No timing baseline; run pnpm quality:calibrate --reason "<reason>"')
  const timingEnabled = baseline && environmentMatches(baseline.environment, environment)
  if (!baseline)
    process.stdout.write('[quality] no baseline; timing is reported but not enforced\n')
  else if (!timingEnabled)
    process.stdout.write(
      '[quality] environment differs from baseline; timing is reported but not enforced\n',
    )

  const results = []
  let exitCode = 0
  for (const name of names) {
    const result = await runCommand(name)
    let timing
    if (timingEnabled && baseline.commands[name]) {
      timing = evaluateTiming(result.durationMs, baseline.commands[name])
      result.timing = timing
    }
    results.push(result)
    if (result.exitCode !== 0 && exitCode === 0) exitCode = result.exitCode
    if (timing) {
      if (timing.blocked) {
        process.stdout.write(
          `[quality] ${name}: timing regression (${formatDuration(result.durationMs)}; baseline ${formatDuration(timing.baselineMs)}, limit ${formatDuration(timing.absoluteLimitMs)})\n`,
        )
        if (args.mode === 'check' && exitCode === 0) exitCode = 1
      }
    }
  }
  writeReport(results, args.mode, environment)
  return exitCode
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((exitCode) => (process.exitCode = exitCode))
    .catch((error) => {
      process.stderr.write(`[quality] ${error.message}\n`)
      process.exitCode = 1
    })
}
