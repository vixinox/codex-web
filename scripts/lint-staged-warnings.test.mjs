import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const scriptPath = join(repoRoot, 'scripts/lint-staged-warnings.mjs')

test('staged lint preserves warning-baseline behavior for file changes', async (context) => {
  const fixture = createRepository(context)
  fixture.write('src/file.ts', "console.log('baseline')\n")
  fixture.commit()

  fixture.write('src/file.ts', "// updated\nconsole.log('baseline')\n")
  fixture.stage('src/file.ts')
  fixture.write('src/file.ts', 'const unstagedError = 1\n')
  const stagedOnly = fixture.lint()
  assert.equal(stagedOnly.status, 0)
  assert.match(stagedOnly.stdout, /checks the Git index snapshot/u)

  fixture.write('src/new.ts', "console.log('new warning')\n")
  fixture.stage('src/new.ts')
  const newWarning = fixture.lint()
  assert.equal(newWarning.status, 1)
  assert.match(newWarning.stderr, /warning.*no-console/u)
})

test('staged lint blocks errors and accepts deleted or documentation-only changes', async (context) => {
  const fixture = createRepository(context)
  fixture.write('src/file.ts', 'export const value = 1\n')
  fixture.commit()

  fixture.write('src/broken.ts', 'const unused = 1\n')
  fixture.stage('src/broken.ts')
  const error = fixture.lint()
  assert.equal(error.status, 1)
  assert.match(error.stderr, /error.*no-unused-vars/u)

  fixture.remove('src/broken.ts')
  fixture.write('docs/note.md', '# Note\n')
  fixture.stage('src/broken.ts', 'docs/note.md')
  assert.equal(fixture.lint().status, 0)
})

test('staged lint maps a renamed file back to its warning baseline', async (context) => {
  const fixture = createRepository(context)
  fixture.write('src/old.ts', "console.log('baseline')\n")
  fixture.commit()

  fixture.rename('src/old.ts', 'src/new.ts')
  fixture.stage('src/old.ts', 'src/new.ts')
  assert.equal(fixture.lint().status, 0)
})

function createRepository(context) {
  const root = mkdtempSync(join(tmpdir(), 'lint-staged-regression-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
  writeFileSync(
    join(root, '.oxlintrc.json'),
    JSON.stringify({ rules: { 'no-console': 'warn', 'no-unused-vars': 'error' } }),
  )
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: {}, include: ['src'] }),
  )
  writeFileSync(
    join(root, 'tsconfig.app.json'),
    JSON.stringify({ compilerOptions: {}, include: ['src'] }),
  )
  writeFileSync(join(root, 'scripts/lint-staged-warnings.mjs'), readFileSyncScript())
  runGit(root, ['init', '--quiet'])
  runGit(root, ['config', 'user.name', 'Test'])
  runGit(root, ['config', 'user.email', 'test@example.invalid'])

  return {
    root,
    write(path, contents) {
      const absolutePath = join(root, path)
      mkdirSync(join(absolutePath, '..'), { recursive: true })
      writeFileSync(absolutePath, contents)
    },
    remove(path) {
      rmSync(join(root, path), { force: true })
    },
    rename(from, to) {
      const source = join(root, from)
      mkdirSync(join(root, to, '..'), { recursive: true })
      renameSync(source, join(root, to))
    },
    stage(...paths) {
      runGit(root, ['add', '--', ...paths])
    },
    commit() {
      runGit(root, ['add', '--all'])
      runGit(root, ['commit', '--quiet', '-m', 'fixture'])
    },
    lint() {
      return spawnSync(process.execPath, [join(root, 'scripts/lint-staged-warnings.mjs')], {
        cwd: root,
        encoding: 'utf8',
      })
    },
  }
}

function readFileSyncScript() {
  return readFileSync(scriptPath)
}

function runGit(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}
