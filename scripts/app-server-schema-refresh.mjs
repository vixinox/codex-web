import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fetchLatestRelease,
  parseReleaseVersion,
  requireReleaseAsset,
  resolveGenerator,
  runCodexTool,
  targetFor,
} from './app-server-schema-generator.mjs'
import {
  compareReviewedCoverage,
  publishSnapshot,
  readSchemaSet,
  reportDifferences,
  validateGeneratedSchemas,
  writeCurrentPointer,
} from './app-server-schema-snapshot.mjs'

const REVIEWED_CATALOG = 'packages/server/src/codex/fixtures/conversation-schema-coverage.json'

export { compareReviewedCoverage, parseReleaseVersion, targetFor }

export async function refreshSchema({
  root,
  fetchImpl = fetch,
  findExecutable,
  run = runCodexTool,
  download,
  extract,
  platform = process.platform,
  architecture = process.arch,
  log = (message) => process.stdout.write(`${message}\n`),
}) {
  const target = targetFor(platform, architecture)
  const release = await fetchLatestRelease(fetchImpl)
  const version = parseReleaseVersion(release)
  const cliAsset = requireReleaseAsset(release, target.cliAsset, true)
  log(`Latest stable Codex release: ${version}`)

  const generator = await resolveGenerator({
    root,
    version,
    target,
    cliAsset,
    findExecutable,
    run,
    download,
    extract,
    fetchImpl,
    log,
  })

  const schemaRoot = join(root, 'docs', 'vendor', 'codex-app-server')
  const snapshotPath = join(schemaRoot, version)
  const stagingPath = join(schemaRoot, `.staging-${version}-${randomUUID()}`)
  const home = await mkdtemp(join(tmpdir(), 'codex-schema-home-'))
  try {
    await mkdir(stagingPath, { recursive: true })
    await run(generator.executable, ['app-server', 'generate-json-schema', '--out', stagingPath], {
      env: { ...process.env, CODEX_HOME: home },
      timeoutMs: 300_000,
    })
    const generatedFiles = await validateGeneratedSchemas(stagingPath, version)
    const schemas = await readSchemaSet(stagingPath)
    const catalog = JSON.parse(await readFile(join(root, REVIEWED_CATALOG), 'utf8'))
    const differences = compareReviewedCoverage(schemas, catalog)
    const metadata = {
      schemaVersion: version,
      releaseTag: release.tag_name,
      generatorVersion: generator.version,
      generatorSource: generator.source,
    }
    await writeFile(
      join(stagingPath, 'codex-schema-snapshot.json'),
      `${JSON.stringify(metadata, null, 2)}\n`,
    )
    const published = await publishSnapshot({ snapshotPath, stagingPath, generatedFiles })
    await mkdir(schemaRoot, { recursive: true })
    await writeCurrentPointer(schemaRoot, version)
    reportDifferences(differences, log)
    log(
      `${published ? 'Generated' : 'Reused'} local App Server JSON Schema snapshot ${version}: ${snapshotPath}`,
    )
    return { version, snapshotPath, generatorSource: generator.source, differences, published }
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined)
    await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
  }
}
