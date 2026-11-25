import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { refreshSchema } from './app-server-schema-refresh.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

if (
  process.env.NODE_USE_ENV_PROXY === undefined &&
  (process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy)
) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: root,
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
    stdio: 'inherit',
  })
  if (child.error) throw child.error
  process.exitCode = child.status ?? 1
} else {
  try {
    await refreshSchema({ root })
  } catch (error) {
    process.stderr.write(
      `[schema:update] ${error instanceof Error ? error.message : 'Schema refresh failed'}\n`,
    )
    process.exitCode = 1
  }
}
