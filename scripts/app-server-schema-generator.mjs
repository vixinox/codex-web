import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { access, chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createReadStream, createWriteStream } from 'node:fs'
import { delimiter } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const API_URL = 'https://api.github.com/repos/openai/codex/releases/latest'
const USER_AGENT = 'codex-web-app-server-schema-refresh'

const TARGETS = {
  'win32-x64': {
    id: 'windows-x64',
    executable: 'codex.exe',
    archiveExecutable: 'codex-x86_64-pc-windows-msvc.exe',
    cliAsset: 'codex-x86_64-pc-windows-msvc.exe.tar.gz',
  },
  'win32-arm64': {
    id: 'windows-arm64',
    executable: 'codex.exe',
    archiveExecutable: 'codex-aarch64-pc-windows-msvc.exe',
    cliAsset: 'codex-aarch64-pc-windows-msvc.exe.tar.gz',
  },
  'darwin-x64': {
    id: 'macos-x64',
    executable: 'codex',
    archiveExecutable: 'codex-x86_64-apple-darwin',
    cliAsset: 'codex-x86_64-apple-darwin.tar.gz',
  },
  'darwin-arm64': {
    id: 'macos-arm64',
    executable: 'codex',
    archiveExecutable: 'codex-aarch64-apple-darwin',
    cliAsset: 'codex-aarch64-apple-darwin.tar.gz',
  },
  'linux-x64': {
    id: 'linux-x64',
    executable: 'codex',
    archiveExecutable: 'codex-x86_64-unknown-linux-musl',
    cliAsset: 'codex-x86_64-unknown-linux-musl.tar.gz',
  },
  'linux-arm64': {
    id: 'linux-arm64',
    executable: 'codex',
    archiveExecutable: 'codex-aarch64-unknown-linux-musl',
    cliAsset: 'codex-aarch64-unknown-linux-musl.tar.gz',
  },
}

export function targetFor(platform = process.platform, architecture = process.arch) {
  const target = TARGETS[`${platform}-${architecture}`]
  if (!target)
    throw new Error(
      `Codex App Server schema generation is unsupported on ${platform}/${architecture}`,
    )
  return target
}

export function parseReleaseVersion(release) {
  if (release?.draft || release?.prerelease)
    throw new Error('GitHub latest release must be a published stable release')
  const match = /^rust-v(\d+\.\d+\.\d+)$/u.exec(release?.tag_name ?? '')
  if (!match)
    throw new Error(`Unsupported Codex stable release tag: ${release?.tag_name ?? 'missing'}`)
  return match[1]
}

export async function fetchLatestRelease(fetchImpl = fetch) {
  const response = await fetchImpl(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok)
    throw new Error(`GitHub latest Codex release lookup failed (${response.status})`)
  const release = await response.json()
  parseReleaseVersion(release)
  return release
}

export function requireReleaseAsset(release, assetName, requireDigest) {
  const asset = release.assets?.find(({ name }) => name === assetName)
  if (!asset?.browser_download_url) throw new Error(`Latest stable release is missing ${assetName}`)
  if (requireDigest && !/^sha256:[a-f0-9]{64}$/iu.test(asset.digest ?? ''))
    throw new Error(`Latest stable release is missing the SHA-256 digest for ${assetName}`)
  return asset
}

export async function resolveGenerator({
  root,
  version,
  target,
  cliAsset,
  findExecutable = findCodexExecutable,
  run = runCodexTool,
  download = downloadAndHash,
  extract = extractCliArchive,
  fetchImpl = fetch,
  log = () => {},
}) {
  const installed = await findExecutable()
  if (installed) {
    const installedVersion = await readCliVersion(installed, run).catch(() => null)
    if (installedVersion === version)
      return { executable: installed, version, source: 'installed Codex CLI' }
  }

  const toolRoot = join(root, '.data', 'codex', 'runtime', 'schema-tools', version, target.id)
  const executablePath = join(toolRoot, target.executable)
  const metadataPath = join(toolRoot, 'schema-tool.json')
  const cached = await readJson(metadataPath).catch(() => null)
  if (
    cached?.version === version &&
    cached?.assetName === cliAsset.name &&
    cached?.executable === target.executable &&
    (await fileExists(executablePath)) &&
    (await hashFile(executablePath)) === cached.sha256 &&
    (await readCliVersion(executablePath, run).catch(() => null)) === version
  ) {
    log(`Reusing cached schema generator ${version} for ${target.id}.`)
    return { executable: executablePath, version, source: 'runtime schema-tools cache' }
  }

  const staging = join(
    root,
    '.data',
    'codex',
    'runtime',
    'schema-tools',
    `.staging-${version}-${randomUUID()}`,
  )
  const extractRoot = join(staging, 'extracted')
  try {
    await mkdir(extractRoot, { recursive: true })
    const archivePath = join(staging, cliAsset.name)
    log(`Downloading matching Codex CLI generator ${version} for ${target.id}.`)
    const digest = await download(fetchImpl, cliAsset.browser_download_url, archivePath)
    const expectedDigest = cliAsset.digest.slice('sha256:'.length).toLowerCase()
    if (digest !== expectedDigest)
      throw new Error(`Codex CLI archive SHA-256 mismatch for ${version}`)
    const extracted = await extract(archivePath, extractRoot, target.archiveExecutable)
    const extractedStat = await import('node:fs/promises').then(({ lstat }) =>
      lstat(extracted).catch(() => null),
    )
    if (!extractedStat?.isFile() || extractedStat.isSymbolicLink())
      throw new Error('Codex CLI archive did not contain its executable')
    if (process.platform !== 'win32') await chmod(extracted, 0o700)
    if ((await readCliVersion(extracted, run)) !== version)
      throw new Error(`Downloaded Codex CLI version did not match ${version}`)

    const stagedExecutable = join(staging, target.executable)
    await copyFile(extracted, stagedExecutable)
    const executableHash = await hashFile(stagedExecutable)
    await writeFile(
      join(staging, 'schema-tool.json'),
      `${JSON.stringify({ version, assetName: cliAsset.name, executable: target.executable, sha256: executableHash }, null, 2)}\n`,
    )
    await rm(extractRoot, { recursive: true, force: true })
    await rm(archivePath, { force: true })
    await mkdir(dirname(toolRoot), { recursive: true })
    await rm(toolRoot, { recursive: true, force: true })
    await rename(staging, toolRoot)
    return { executable: executablePath, version, source: 'downloaded and verified CLI cache' }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function readCliVersion(executable, run) {
  const result = await run(executable, ['--version'], { timeoutMs: 30_000 })
  const match = /\bcodex(?:-cli)?\s+(\d+\.\d+\.\d+)\b/iu.exec(result.stdout)
  if (!match) throw new Error(`Could not read Codex CLI version from ${basename(executable)}`)
  return match[1]
}

async function extractCliArchive(archivePath, destination, archiveExecutable) {
  const listed = await execFile('tar', ['-tzf', archivePath], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const members = listed.stdout
    .split(/\r?\n/u)
    .map((entry) => entry.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, ''))
    .filter(Boolean)
  const executableMembers = members.filter((entry) => {
    const segments = entry.split('/')
    return (
      basename(entry) === archiveExecutable &&
      !entry.startsWith('/') &&
      !/^[A-Za-z]:/u.test(entry) &&
      !segments.includes('..')
    )
  })
  if (executableMembers.length !== 1)
    throw new Error(
      `Codex CLI archive must contain exactly one ${archiveExecutable} executable; found ${executableMembers.map(basename).join(', ') || 'none'}`,
    )
  const member = executableMembers[0]
  await execFile(
    'tar',
    [
      '-xzf',
      archivePath,
      '-C',
      destination,
      '--no-same-owner',
      '--no-same-permissions',
      '--',
      member,
    ],
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
  )
  const executablePath = resolve(destination, ...member.split('/'))
  if (!executablePath.startsWith(`${resolve(destination)}${sep}`))
    throw new Error('Codex CLI archive executable path escaped its staging directory')
  return executablePath
}

async function findCodexExecutable() {
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = process.env.PATH.split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, name))
  const available = await Promise.all(candidates.map(fileExists))
  return candidates.find((_candidate, index) => available[index])
}

export async function runCodexTool(executable, args, options = {}) {
  const { stdout, stderr } = await execFile(executable, args, {
    encoding: 'utf8',
    env: options.env ?? process.env,
    timeout: options.timeoutMs ?? 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return { stdout, stderr }
}

async function downloadAndHash(fetchImpl, url, outputPath) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(300_000),
  })
  if (!response.ok || !response.body)
    throw new Error(`Codex CLI archive download failed (${response.status})`)
  const hash = createHash('sha256')
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body),
    hashing,
    createWriteStream(outputPath, { flags: 'wx' }),
  )
  return hash.digest('hex')
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}
