import { spawn } from 'node:child_process'

export function run(executable: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(executable, args, { env: { ...process.env, ...env }, windowsHide: true })
    let output = ''
    let error = ''
    const timer = setTimeout(() => child.kill(), 10_000)
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (error += chunk.toString()))
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveOutput(output)
      else reject(new Error(`App Server version check failed: ${error || code}`))
    })
  })
}

export function verifyJsonRpc(executable: string, version: string, home: string) {
  return new Promise<void>((resolveVerified, reject) => {
    const child = spawn(executable, ['--listen', 'stdio://'], {
      env: { ...process.env, CODEX_HOME: home },
      windowsHide: true,
      stdio: 'pipe',
    })
    let buffer = ''
    let initialized = false
    const timer = setTimeout(
      () => finish(new Error('App Server protocol smoke test timed out')),
      15_000,
    )
    const finish = (error?: Error) => {
      clearTimeout(timer)
      child.kill()
      if (error) reject(error)
      else resolveVerified()
    }
    child.on('error', (error) => finish(error))
    child.stderr.on('data', () => undefined)
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          finish(new Error('App Server protocol smoke test received non-JSON stdout'))
          return
        }
        if (message.id === 1) {
          const result = message.result as Record<string, unknown> | undefined
          const userAgent = result?.userAgent
          if (typeof userAgent !== 'string' || !userAgent.includes(version)) {
            finish(new Error('App Server initialize response did not match the selected release'))
            return
          }
          initialized = true
          child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
          child.stdin.write(`${JSON.stringify({ method: 'account/read', id: 2, params: {} })}\n`)
        }
        if (initialized && message.id === 2 && ('result' in message || 'error' in message)) finish()
      }
    })
    child.stdin.write(
      `${JSON.stringify({
        method: 'initialize',
        id: 1,
        params: { clientInfo: { name: 'codex_web', title: 'Codex Web', version: '0.0.1' } },
      })}\n`,
    )
  })
}
