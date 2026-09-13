import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

const repoRoot = runGit(['rev-parse', '--show-toplevel']).trim()
const stagedFiles = parseStagedFiles(
  runGit(['diff', '--cached', '--name-status', '--diff-filter=ACMR', '-z']),
)

if (stagedFiles.length === 0) process.exit(0)

const temporaryRoot = mkdtempSync(join(tmpdir(), 'oxlint-staged-'))
const stagedRoot = join(temporaryRoot, 'staged')
const baselineRoot = join(temporaryRoot, 'baseline')

try {
  const stagedSnapshotFiles = writeSnapshot(stagedRoot, stagedFiles, ({ path }) =>
    readGitBlob(`:${path}`),
  )
  const baselineFiles = writeSnapshot(baselineRoot, stagedFiles, ({ baselinePath }) => {
    if (!baselinePath) return undefined

    const revision = `HEAD:${baselinePath}`
    return gitSucceeds(['cat-file', '-e', revision]) ? readGitBlob(revision) : undefined
  })

  const stagedDiagnostics = lint(stagedSnapshotFiles)
  const baselineWarnings = countWarnings(lint(baselineFiles))
  const newWarnings = []
  const diagnostics = []

  for (const diagnostic of stagedDiagnostics) {
    if (diagnostic.severity === 'warning') {
      const key = warningKey(diagnostic)
      const remainingBaselineWarnings = baselineWarnings.get(key) ?? 0

      if (remainingBaselineWarnings > 0) {
        baselineWarnings.set(key, remainingBaselineWarnings - 1)
      } else {
        newWarnings.push(diagnostic)
      }
    } else {
      diagnostics.push(diagnostic)
    }
  }

  diagnostics.push(...newWarnings)

  for (const diagnostic of diagnostics) printDiagnostic(diagnostic)

  if (diagnostics.length > 0) process.exitCode = 1
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true })
}

function writeSnapshot(snapshotRoot, files, readBlob) {
  const snapshotFiles = []

  for (const file of files) {
    const content = readBlob(file)
    if (!content) continue

    const destination = resolve(snapshotRoot, file.path)
    if (
      !destination.startsWith(`${snapshotRoot}\\`) &&
      !destination.startsWith(`${snapshotRoot}/`)
    ) {
      throw new Error(
        `Refusing to write a staged path outside the temporary directory: ${file.path}`,
      )
    }

    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
    snapshotFiles.push(destination)
  }

  return snapshotFiles
}

function lint(files) {
  if (files.length === 0) return []

  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules', 'oxlint', 'bin', 'oxlint'),
      '--format=json',
      '--config',
      join(repoRoot, '.oxlintrc.json'),
      '--tsconfig',
      join(repoRoot, 'tsconfig.json'),
      '--no-error-on-unmatched-pattern',
      ...files,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )

  if (result.error) throw result.error

  try {
    return JSON.parse(result.stdout).diagnostics
  } catch (error) {
    throw new Error(`oxlint did not produce JSON diagnostics:\n${result.stderr || result.stdout}`, {
      cause: error,
    })
  }
}

function countWarnings(diagnostics) {
  const warnings = new Map()

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'warning') continue

    const key = warningKey(diagnostic)
    warnings.set(key, (warnings.get(key) ?? 0) + 1)
  }

  return warnings
}

function warningKey(diagnostic) {
  return `${diagnostic.code}\0${diagnostic.message}`
}

function printDiagnostic(diagnostic) {
  const label = diagnostic.labels?.[0]
  const span = label?.span
  const filename = relative(stagedRoot, diagnostic.filename).replaceAll('\\', '/')
  const displayPath = filename.startsWith('..') ? basename(diagnostic.filename) : filename
  const location = span ? `:${span.line}:${span.column}` : ''
  const code = diagnostic.code ? ` (${diagnostic.code})` : ''

  console.error(`${displayPath}${location}: ${diagnostic.severity}${code}: ${diagnostic.message}`)
}

function readGitBlob(revision) {
  const result = spawnSync('git', ['show', revision], {
    cwd: repoRoot,
    encoding: null,
  })

  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`Unable to read staged file ${revision}: ${result.stderr}`)

  return result.stdout
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim())

  return result.stdout
}

function gitSucceeds(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, stdio: 'ignore' })
  return result.status === 0
}

function parseStagedFiles(output) {
  const fields = output.split('\0')
  const files = []

  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++]
    const isRenameOrCopy = status.startsWith('R') || status.startsWith('C')
    const originalPath = isRenameOrCopy ? fields[index++] : undefined
    const path = fields[index++]

    files.push({
      path,
      baselinePath: status.startsWith('R')
        ? originalPath
        : status.startsWith('M')
          ? path
          : undefined,
    })
  }

  return files
}
