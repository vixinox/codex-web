import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

// Set this before spawning tsx/Vite so Node's native fetch uses HTTP(S)_PROXY
// on both Windows and Linux.
process.env.NODE_USE_ENV_PROXY ??= '1'

const port = Number(process.argv[2])
const command = process.argv[3]
const args = process.argv.slice(4)
if (!Number.isInteger(port) || !command)
  throw new Error('Usage: with-port <port> <command> [...args]')

if (process.platform === 'win32') {
  const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
  const pids = new Set()
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes(`127.0.0.1:${port}`) || !line.includes('LISTENING')) continue
    const pid = line.trim().split(/\s+/).at(-1)
    if (pid && /^\d+$/.test(pid) && pid !== String(process.pid)) pids.add(pid)
  }
  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // The process may have exited between netstat and taskkill.
    }
  }
}

const require = createRequire(import.meta.url)
let executable = command
let executableArgs = args
const serverEntrypoint = args.some((arg) => {
  const normalized = arg.replaceAll('\\', '/')
  return (
    normalized.endsWith('server/owner/server.ts') || normalized.endsWith('server/guest/server.ts')
  )
})
const exitOnServerStartupFailure =
  (port === 3000 || process.env.CODEX_EXIT_ON_SERVER_STARTUP_FAILURE === 'true') && serverEntrypoint

if (process.platform === 'win32') {
  try {
    const packageJson = require.resolve(`${command}/package.json`)
    const packageInfo = require(packageJson)
    const bin = typeof packageInfo.bin === 'string' ? packageInfo.bin : packageInfo.bin?.[command]
    if (bin) {
      executable = process.execPath
      executableArgs = [path.resolve(path.dirname(packageJson), bin), ...args]
    }
  } catch {
    // Fall back to the platform command when it is not a Node package.
  }
}

let fatalStartupFailure = false
let stderrTail = ''
const child = spawn(executable, executableArgs, {
  stdio: exitOnServerStartupFailure ? ['inherit', 'inherit', 'pipe'] : 'inherit',
})
if (child.stderr) {
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    process.stderr.write(text)
    stderrTail = `${stderrTail}${text}`.slice(-1_000)
    if (!fatalStartupFailure && stderrTail.includes('Server failed to start:')) {
      fatalStartupFailure = true
      child.kill()
    }
  })
}
child.on('exit', (code, signal) => {
  if (fatalStartupFailure) process.exit(1)
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
