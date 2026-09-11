import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [command, ...args] = process.argv.slice(2)

if (!command) throw new Error('Usage: run-with-env <command> [...args]')

// Load the project environment before starting tsx or another child process.
// Existing environment variables win, matching dotenv's default behavior.
dotenv.config({ path: path.join(root, '.env'), quiet: true })

// Node's native fetch only reads proxy variables when this is enabled before
// the child process starts.
process.env.NODE_USE_ENV_PROXY ??= '1'

const require = createRequire(import.meta.url)
let executable = command
let executableArgs = args

// On Windows, invoking a package bin by its bare name through spawn() does not
// reliably resolve the package's .cmd shim. Resolve the package bin directly
// and run it with the current Node executable instead.
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
    // Fall back to the platform command for non-package executables.
  }
}

const child = spawn(executable, executableArgs, { stdio: 'inherit', env: process.env })

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
