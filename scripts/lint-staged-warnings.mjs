import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

const repoRoot = runGit(['rev-parse', '--show-toplevel']).trim()
const stagedEntries = parseIndexEntries(runGit(['ls-files', '--stage', '-z']))
const baselineEntries = parseTreeEntries(runGit(['ls-tree', '-r', '-z', 'HEAD']))
const baselinePaths = baselineEntries.map(({ path }) => path)
const stagedFiles = parseStagedFiles(
  runGit(['diff', '--cached', '--name-status', '--diff-filter=ACMR', '-z']),
).map((file) => ({
  ...file,
  baselinePath: file.baselinePath ?? findMovedBaselinePath(file.path, baselinePaths),
}))

if (stagedFiles.length === 0) process.exit(0)

const temporaryRoot = mkdtempSync(join(tmpdir(), 'oxlint-staged-'))
const stagedRoot = join(temporaryRoot, 'staged')
const baselineRoot = join(temporaryRoot, 'baseline')

try {
  const stagedBlobs = readBlobs(stagedEntries)
  writeSnapshot(stagedRoot, stagedEntries, stagedBlobs)
  writeSnapshot(baselineRoot, baselineEntries, readBlobs(baselineEntries))
  const stagedBlobByPath = new Map(
    stagedEntries.map(({ path, oid }) => [path, stagedBlobs.get(oid)]),
  )
  const worktreeDifferenceCount = stagedFiles.filter((file) => {
    const stagedBlob = stagedBlobByPath.get(file.path)
    if (!stagedBlob) return false
    try {
      return !readFileSync(resolve(repoRoot, file.path)).equals(stagedBlob)
    } catch {
      return true
    }
  }).length
  if (worktreeDifferenceCount > 0) {
    console.log(
      `lint:staged checks the Git index snapshot; ${worktreeDifferenceCount} staged file(s) differ from the working tree.`,
    )
  }
  linkNodeModules(stagedRoot)
  linkNodeModules(baselineRoot)
  const stagedSnapshotFiles = stagedFiles
    .map(({ path }) => resolve(stagedRoot, path))
    .filter(existsSync)
  const baselineFiles = stagedFiles
    .map(({ baselinePath }) => (baselinePath ? resolve(baselineRoot, baselinePath) : undefined))
    .filter((path) => path !== undefined && existsSync(path))

  const stagedDiagnostics = lint(stagedSnapshotFiles, stagedRoot)
  const baselineWarnings = countWarnings(lint(baselineFiles, baselineRoot))
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

function writeSnapshot(snapshotRoot, entries, blobs) {
  mkdirSync(snapshotRoot, { recursive: true })
  const snapshotFiles = []

  for (const { path, oid } of entries) {
    const content = blobs.get(oid)
    if (!content) continue

    const destination = resolve(snapshotRoot, path)
    if (
      !destination.startsWith(`${snapshotRoot}\\`) &&
      !destination.startsWith(`${snapshotRoot}/`)
    ) {
      throw new Error(`Refusing to write a staged path outside the temporary directory: ${path}`)
    }

    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
    snapshotFiles.push(destination)
  }

  return snapshotFiles
}

function linkNodeModules(snapshotRoot) {
  symlinkSync(
    join(repoRoot, 'node_modules'),
    join(snapshotRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}

function lint(files, snapshotRoot) {
  const lintableFiles = files.filter((file) => /\.(?:[cm]?ts|tsx)$/.test(file))
  if (lintableFiles.length === 0) return []

  const filesByTsconfig = new Map()
  for (const file of lintableFiles) {
    const relativePath = relative(snapshotRoot, file).replaceAll('\\', '/')
    const tsconfig = tsconfigForPath(relativePath)
    const group = filesByTsconfig.get(tsconfig) ?? []
    group.push(file)
    filesByTsconfig.set(tsconfig, group)
  }

  return [...filesByTsconfig].flatMap(([tsconfig, group]) => runLint(group, snapshotRoot, tsconfig))
}

function runLint(files, snapshotRoot, tsconfig) {
  const tsconfigPath = resolve(snapshotRoot, tsconfig)

  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules', 'oxlint', 'bin', 'oxlint'),
      '--format=json',
      '--config',
      join(snapshotRoot, '.oxlintrc.json'),
      '--tsconfig',
      tsconfigPath,
      '--no-error-on-unmatched-pattern',
      ...files,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )

  if (result.error) throw result.error

  try {
    return JSON.parse(result.stdout).diagnostics.filter(
      (diagnostic) =>
        !(
          diagnostic.code === 'typescript(tsconfig-error)' &&
          diagnostic.filename?.endsWith('tsconfig.json')
        ),
    )
  } catch (error) {
    throw new Error(`oxlint did not produce JSON diagnostics:\n${result.stderr || result.stdout}`, {
      cause: error,
    })
  }
}

function tsconfigForPath(path) {
  if (path.startsWith('packages/app/')) return 'packages/app/tsconfig.json'
  if (path.startsWith('packages/server/')) return 'packages/server/tsconfig.json'
  if (path.startsWith('packages/protocol/')) return 'packages/protocol/tsconfig.json'
  if (path.startsWith('packages/relay/')) return 'packages/relay/tsconfig.json'
  if (path.startsWith('src/')) return 'tsconfig.app.json'
  if (path.startsWith('server/')) return 'server/tsconfig.json'
  if (path.startsWith('packages/owner-protocol/')) return 'packages/owner-protocol/tsconfig.json'
  if (path.startsWith('packages/remote-protocol/')) return 'packages/remote-protocol/tsconfig.json'
  if (path.startsWith('apps/relay/')) return 'apps/relay/tsconfig.json'
  return 'tsconfig.json'
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

function readBlobs(entries) {
  const objectIds = [...new Set(entries.map(({ oid }) => oid))]
  if (objectIds.length === 0) return new Map()
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    input: `${objectIds.join('\n')}\n`,
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Unable to read Git objects: ${String(result.stderr)}`)

  const blobs = new Map()
  let offset = 0
  for (const expectedOid of objectIds) {
    const headerEnd = result.stdout.indexOf(10, offset)
    if (headerEnd < 0) throw new Error('Git returned an incomplete object header.')
    const [oid, type, sizeText] = result.stdout.toString('ascii', offset, headerEnd).split(' ')
    const size = Number(sizeText)
    if (oid !== expectedOid || type !== 'blob' || !Number.isSafeInteger(size))
      throw new Error(`Unexpected Git object response for ${expectedOid}.`)
    const contentStart = headerEnd + 1
    const contentEnd = contentStart + size
    if (result.stdout[contentEnd] !== 10)
      throw new Error(`Git object ${expectedOid} was truncated.`)
    blobs.set(oid, result.stdout.subarray(contentStart, contentEnd))
    offset = contentEnd + 1
  }
  return blobs
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim())

  return result.stdout
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

function findMovedBaselinePath(path, availablePaths) {
  const candidates = []

  if (path.startsWith('packages/app/')) {
    const relativePath = path.slice('packages/app/'.length)
    candidates.push(relativePath)
    if (relativePath === 'tsconfig.json') candidates.push('tsconfig.app.json')
  }
  if (path.startsWith('packages/server/src/'))
    candidates.push(`server/${path.slice('packages/server/src/'.length)}`)
  if (path.startsWith('packages/server/scripts/'))
    candidates.push(`scripts/${path.slice('packages/server/scripts/'.length)}`)
  if (path === 'packages/server/drizzle.config.ts') candidates.push('drizzle.config.ts')
  if (path === 'packages/server/tsconfig.json') candidates.push('server/tsconfig.json')
  if (path.startsWith('packages/relay/src/'))
    candidates.push(`apps/relay/${path.slice('packages/relay/src/'.length)}`)
  if (path.startsWith('packages/protocol/src/owner/'))
    candidates.push(
      `packages/owner-protocol/src/${path.slice('packages/protocol/src/owner/'.length)}`,
    )
  if (path.startsWith('packages/protocol/src/relay/'))
    candidates.push(
      `packages/remote-protocol/src/${path.slice('packages/protocol/src/relay/'.length)}`,
    )

  return candidates.find((candidate) => availablePaths.includes(candidate))
}

function parseIndexEntries(output) {
  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t')
      const [mode, oid, stage] = entry.slice(0, tab).split(' ')
      return { mode, oid, stage, path: entry.slice(tab + 1) }
    })
    .filter(({ stage }) => stage === '0')
}

function parseTreeEntries(output) {
  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t')
      const [mode, type, oid] = entry.slice(0, tab).split(' ')
      return { mode, type, oid, path: entry.slice(tab + 1) }
    })
    .filter(({ type }) => type === 'blob')
}
