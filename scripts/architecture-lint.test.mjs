import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const oxlint = join(repoRoot, 'node_modules', 'oxlint', 'bin', 'oxlint')

test('architecture budgets protect selected production clusters and leave tests and unrelated code alone', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'codex-architecture-lint-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, '.oxlintrc.architecture.json'), readFileSync(join(repoRoot, '.oxlintrc.architecture.json')))
  const paths = [
    'packages/server/src/owner/application-services.ts',
    'packages/server/src/owner/application/new/nested.ts',
    'packages/server/src/codex/process/new/nested.ts',
    'packages/server/src/codex/runtime/new/nested.ts',
    'packages/server/src/remote/sessions/new/nested.ts',
    'packages/server/src/owner/session-runtime.ts',
  ]
  const excluded = [
    'packages/server/src/owner/application/example.test.ts',
    'packages/server/src/codex/runtime/fixtures/example.ts',
    'packages/server/src/workspace.ts',
    'packages/app/src/example.ts',
  ]
  const write = (path, lines) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), `${'// physical line\n'.repeat(lines - 1)}export {}\n`)
  }
  for (const path of paths) write(path, 450)
  for (const path of excluded) write(path, 470)
  const lint = () => spawnSync(process.execPath, [oxlint, '.', '--config', '.oxlintrc.architecture.json', '--format', 'json'], { cwd: root, encoding: 'utf8' })
  let result = lint()
  assert.equal(result.status, 0, result.stdout || result.stderr)
  for (const path of paths) write(path, 451)
  result = lint()
  assert.equal(result.status, 1, result.stdout || result.stderr)
  const failures = JSON.parse(result.stdout).diagnostics.filter(({ code }) => code === 'eslint(max-lines)')
  assert.deepEqual(failures.map(({ filename }) => filename.replaceAll('\\', '/')).sort(), paths.sort())
  assert.ok(failures.every(({ message, help }) => message.includes('451') && help.includes('450')))
  writeFileSync(join(root, '.oxlintrc.json'), readFileSync(join(repoRoot, '.oxlintrc.json')))
  const inherited = spawnSync(process.execPath, [oxlint, paths[0], '--config', '.oxlintrc.json', '--format', 'json'], { cwd: root, encoding: 'utf8' })
  assert.equal(inherited.status, 1, inherited.stdout || inherited.stderr)
  assert.ok(JSON.parse(inherited.stdout).diagnostics.some(({ code }) => code === 'eslint(max-lines)'))
})
