import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  compareReviewedCoverage,
  parseReleaseVersion,
  refreshSchema,
  targetFor,
} from './app-server-schema-refresh.mjs'

const VERSION = '0.172.0'
const TARGET = targetFor('win32', 'x64')
const EXECUTABLE_BYTES = Buffer.from('codex-cli-fixture')
const EXECUTABLE_HASH = createHash('sha256').update(EXECUTABLE_BYTES).digest('hex')

test('schema refresh rejects draft, prerelease, and malformed release tags', () => {
  assert.equal(
    parseReleaseVersion({ tag_name: 'rust-v0.172.0', draft: false, prerelease: false }),
    VERSION,
  )
  assert.throws(
    () => parseReleaseVersion({ tag_name: 'rust-v0.172.0', draft: true }),
    /published stable/u,
  )
  assert.throws(() => parseReleaseVersion({ tag_name: 'rust-v0.172.0-rc.1' }), /Unsupported/u)
})

test('schema refresh chooses the matching platform CLI and App Server assets', () => {
  assert.equal(targetFor('win32', 'x64').cliAsset, 'codex-x86_64-pc-windows-msvc.exe.tar.gz')
  assert.equal(targetFor('darwin', 'arm64').id, 'macos-arm64')
  assert.throws(() => targetFor('freebsd', 'x64'), /unsupported/u)
})

test('schema diff reports additions and removals without expanding the reviewed catalog', () => {
  const differences = compareReviewedCoverage(
    {
      ThreadItem: union(['userMessage', 'newItem']),
      ThreadRealtimeItem: union(['audio']),
      ServerRequest: union(['item/commandExecution/requestApproval']),
      ServerNotification: union(['turn/started', 'new/notice'], 'method'),
    },
    {
      threadItems: ['userMessage', 'oldItem'],
      threadRealtimeItems: ['audio'],
      serverRequests: ['item/commandExecution/requestApproval'],
      serverNotifications: { all: ['turn/started'] },
    },
  )
  assert.deepEqual(differences.ThreadItem, { added: ['newItem'], removed: ['oldItem'] })
  assert.deepEqual(differences.ServerNotification, { added: ['new/notice'], removed: [] })
})

test('schema refresh reuses a matching CLI cache and publishes an immutable version snapshot', async (context) => {
  const root = createRoot(context)
  const executable = writeCachedGenerator(root)
  const releaseCalls = []
  const downloads = []
  const fake = createFakeRelease()
  const first = await refreshSchema({
    root,
    fetchImpl: async (...args) => {
      releaseCalls.push(args[0])
      return fake.response()
    },
    findExecutable: async () => undefined,
    run: fake.run,
    download: async () => {
      downloads.push(true)
      throw new Error('should reuse generator cache')
    },
    extract: async () => {
      throw new Error('should reuse generator cache')
    },
    platform: 'win32',
    architecture: 'x64',
    log: () => {},
  })
  assert.equal(first.version, VERSION)
  assert.equal(first.generatorSource, 'runtime schema-tools cache')
  assert.equal(first.published, true)
  assert.deepEqual(downloads, [])
  assert.equal(releaseCalls.length, 1, 'latest stable is checked on every invocation')
  assert.equal(
    readFileSync(join(root, 'docs/vendor/codex-app-server/current-version.txt'), 'utf8'),
    `${VERSION}\n`,
  )
  assert.equal(existsSync(executable), true)

  const snapshot = join(root, 'docs/vendor/codex-app-server', VERSION)
  const schemaBefore = readFileSync(join(snapshot, 'ServerRequest.json'), 'utf8')
  const snapshotMetadata = JSON.parse(
    readFileSync(join(snapshot, 'codex-schema-snapshot.json'), 'utf8'),
  )
  assert.equal('files' in snapshotMetadata, false)
  const second = await refreshSchema({
    root,
    fetchImpl: async () => fake.response(),
    findExecutable: async () => undefined,
    run: fake.run,
    platform: 'win32',
    architecture: 'x64',
    log: () => {},
  })
  assert.equal(second.published, false)
  assert.equal(readFileSync(join(snapshot, 'ServerRequest.json'), 'utf8'), schemaBefore)
  assert.equal(
    'files' in JSON.parse(readFileSync(join(snapshot, 'codex-schema-snapshot.json'), 'utf8')),
    false,
  )
})

test('schema refresh prefers a locally installed Codex CLI when its version matches latest stable', async (context) => {
  const root = createRoot(context)
  const installed = join(root, TARGET.executable)
  writeFileSync(installed, 'installed codex')
  const fake = createFakeRelease()
  const called = []
  const result = await refreshSchema({
    root,
    fetchImpl: async () => fake.response(),
    findExecutable: async () => installed,
    run: async (executable, args, options) => {
      called.push({ executable, args })
      return fake.run(executable, args, options)
    },
    download: async () => assert.fail('matching installed CLI should be reused'),
    extract: async () => assert.fail('matching installed CLI should be reused'),
    platform: 'win32',
    architecture: 'x64',
    log: () => {},
  })
  assert.equal(result.generatorSource, 'installed Codex CLI')
  assert.ok(
    called.some(({ executable, args }) => executable === installed && args[0] === '--version'),
  )
  assert.ok(
    called.some(({ executable, args }) => executable === installed && args[0] === 'app-server'),
  )
})

test('schema refresh downloads and verifies a matching CLI when no installed or cached CLI exists', async (context) => {
  const root = createRoot(context)
  const fake = createFakeRelease()
  const fetchCalls = []
  const downloaded = []
  const result = await refreshSchema({
    root,
    fetchImpl: async (url) => {
      fetchCalls.push(url)
      return fake.response()
    },
    findExecutable: async () => undefined,
    run: fake.run,
    download: async (_fetchImpl, url, outputPath) => {
      downloaded.push(url)
      writeFileSync(outputPath, 'verified archive fixture')
      return createHash('sha256').update('verified archive fixture').digest('hex')
    },
    extract: async (_archivePath, destination, executableName) => {
      const path = join(destination, executableName)
      writeFileSync(path, EXECUTABLE_BYTES)
      return path
    },
    platform: 'win32',
    architecture: 'x64',
    log: () => {},
  })
  assert.equal(result.generatorSource, 'downloaded and verified CLI cache')
  assert.equal(fetchCalls.length, 1)
  assert.equal(downloaded[0], `https://example.test/${TARGET.cliAsset}`)
  const toolRoot = join(root, '.data/codex/runtime/schema-tools', VERSION, TARGET.id)
  assert.equal(
    readFileSync(join(toolRoot, TARGET.executable)).toString(),
    EXECUTABLE_BYTES.toString(),
  )
  assert.equal(
    JSON.parse(readFileSync(join(toolRoot, 'schema-tool.json'), 'utf8')).sha256,
    EXECUTABLE_HASH,
  )
  assert.equal(
    readdirSync(toolRoot).some((name) => name.endsWith('.tar.gz')),
    false,
  )
})

test('schema refresh leaves the old pointer untouched when archive digest verification fails', async (context) => {
  const root = createRoot(context)
  const pointer = join(root, 'docs/vendor/codex-app-server/current-version.txt')
  mkdirSync(join(root, 'docs/vendor/codex-app-server'), { recursive: true })
  writeFileSync(pointer, '0.167.0\n')
  const fake = createFakeRelease()
  await assert.rejects(
    refreshSchema({
      root,
      fetchImpl: async () => fake.response(),
      findExecutable: async () => undefined,
      run: fake.run,
      download: async () => '0'.repeat(64),
      extract: async () => assert.fail('must not extract an unverified archive'),
      platform: 'win32',
      architecture: 'x64',
      log: () => {},
    }),
    /SHA-256 mismatch/u,
  )
  assert.equal(readFileSync(pointer, 'utf8'), '0.167.0\n')
  assert.equal(existsSync(join(root, 'docs/vendor/codex-app-server', VERSION)), false)
})

test('schema refresh leaves the current pointer unchanged when the latest lookup fails', async (context) => {
  const root = createRoot(context)
  const pointer = join(root, 'docs/vendor/codex-app-server/current-version.txt')
  mkdirSync(join(root, 'docs/vendor/codex-app-server'), { recursive: true })
  writeFileSync(pointer, '0.167.0\n')
  await assert.rejects(
    refreshSchema({
      root,
      fetchImpl: async () => new Response('offline', { status: 503 }),
      platform: 'win32',
      architecture: 'x64',
      log: () => {},
    }),
    /lookup failed \(503\)/u,
  )
  assert.equal(readFileSync(pointer, 'utf8'), '0.167.0\n')
})

test('schema refresh refuses to overwrite a different immutable snapshot', async (context) => {
  const root = createRoot(context)
  writeCachedGenerator(root)
  const snapshot = join(root, 'docs/vendor/codex-app-server', VERSION)
  const fake = createFakeRelease()
  await refreshSchema({
    root,
    fetchImpl: async () => fake.response(),
    findExecutable: async () => undefined,
    run: fake.run,
    platform: 'win32',
    architecture: 'x64',
    log: () => {},
  })
  const pointer = join(root, 'docs/vendor/codex-app-server/current-version.txt')
  writeFileSync(join(snapshot, 'ClientRequest.json'), 'different')
  await assert.rejects(
    refreshSchema({
      root,
      fetchImpl: async () => fake.response(),
      findExecutable: async () => undefined,
      run: fake.run,
      platform: 'win32',
      architecture: 'x64',
      log: () => {},
    }),
    /immutable and differs/u,
  )
  assert.equal(readFileSync(pointer, 'utf8'), `${VERSION}\n`)
  assert.equal(readFileSync(join(snapshot, 'ClientRequest.json'), 'utf8'), 'different')
})

function createRoot(context) {
  const root = mkdtempSync(join(tmpdir(), 'codex-schema-refresh-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'packages/server/src/codex/fixtures'), { recursive: true })
  writeFileSync(
    join(root, 'packages/server/src/codex/fixtures/conversation-schema-coverage.json'),
    JSON.stringify({
      schemaVersion: '0.167.0',
      threadItems: ['userMessage'],
      threadRealtimeItems: ['audio'],
      serverRequests: ['item/commandExecution/requestApproval'],
      serverNotifications: { all: ['turn/started'] },
    }),
  )
  return root
}

function writeCachedGenerator(root) {
  const toolRoot = join(root, '.data/codex/runtime/schema-tools', VERSION, TARGET.id)
  mkdirSync(toolRoot, { recursive: true })
  const executable = join(toolRoot, TARGET.executable)
  writeFileSync(executable, EXECUTABLE_BYTES)
  writeFileSync(
    join(toolRoot, 'schema-tool.json'),
    JSON.stringify({
      version: VERSION,
      assetName: TARGET.cliAsset,
      executable: TARGET.executable,
      sha256: EXECUTABLE_HASH,
    }),
  )
  return executable
}

function createFakeRelease() {
  const cliDigest = `sha256:${createHash('sha256').update('verified archive fixture').digest('hex')}`
  const release = {
    tag_name: `rust-v${VERSION}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: TARGET.cliAsset,
        browser_download_url: `https://example.test/${TARGET.cliAsset}`,
        digest: cliDigest,
      },
    ],
  }
  const run = async (_executable, args) => {
    if (args[0] === '--version') return { stdout: `codex-cli ${VERSION}\n`, stderr: '' }
    assert.deepEqual(args.slice(0, 3), ['app-server', 'generate-json-schema', '--out'])
    writeFakeSchemas(args[3])
    return { stdout: '', stderr: '' }
  }
  return { response: () => Response.json(release), run }
}

function writeFakeSchemas(directory) {
  mkdirSync(join(directory, 'v2'), { recursive: true })
  const asUnion = (names, key) => ({
    oneOf: names.map((name) => ({ properties: { [key]: { enum: [name] } } })),
  })
  writeFileSync(
    join(directory, 'codex_app_server_protocol.schemas.json'),
    JSON.stringify({ definitions: { RequestId: { type: 'string' } } }),
  )
  writeFileSync(
    join(directory, 'codex_app_server_protocol.v2.schemas.json'),
    JSON.stringify({
      definitions: {
        ThreadItem: asUnion(['userMessage', 'newItem'], 'type'),
        ThreadRealtimeItem: asUnion(['audio'], 'type'),
      },
    }),
  )
  writeFileSync(join(directory, 'ClientRequest.json'), JSON.stringify({ type: 'object' }))
  writeFileSync(
    join(directory, 'ServerRequest.json'),
    JSON.stringify(asUnion(['item/commandExecution/requestApproval'], 'method')),
  )
  writeFileSync(
    join(directory, 'ServerNotification.json'),
    JSON.stringify(asUnion(['turn/started', 'new/notice'], 'method')),
  )
  writeFileSync(join(directory, 'v2/ThreadStartParams.json'), JSON.stringify({ type: 'object' }))
}

function union(names, discriminator = 'type') {
  return { oneOf: names.map((name) => ({ properties: { [discriminator]: { enum: [name] } } })) }
}
