import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'

import type { ServerConfig } from '../config.js'
import { log, safeError } from '../logger.js'
import type { CodexCommand } from './stdio-transport.js'

// Node's native fetch does not consume HTTP(S)_PROXY unless this opt-in is set.
// Enable it when the host already provides a proxy, which is common on managed
// desktops where browsers and curl can reach GitHub but direct TCP cannot.
if (
  process.env.NODE_USE_ENV_PROXY === undefined &&
  (process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy)
) {
  process.env.NODE_USE_ENV_PROXY = '1'
  log.info('Using the configured HTTP(S) proxy for Codex runtime downloads')
}

const GITHUB_API = 'https://api.github.com/repos/openai/codex/releases'

type ReleaseAsset = {
  name: string
  browser_download_url: string
  digest?: string | null
}

type GitHubRelease = {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: ReleaseAsset[]
}

import {
  CodexRuntimeError,
  compatible,
  emptyManifest,
  isPathWithin,
  isSafeVersion,
  releaseVersion,
  safeManifest,
  targetFor,
  type CandidateEntry,
  type PlatformTarget,
  type RuntimeEntry,
  type CodexRuntimeManifest,
} from './runtime-policy.js'

export type { CodexRuntimeManifest } from './runtime-policy.js'
export { CodexRuntimeError, SUPPORTED_CODEX_RANGE, targetFor } from './runtime-policy.js'

export type CodexRuntimeStatus = {
  source: 'managed-release' | 'explicit-command'
  platform: string
  channel: 'stable'
  requestedVersion: string | null
  activeVersion: string | null
  candidateVersion: string | null
  candidateStatus: 'none' | 'pending' | 'passed' | 'failed'
  lastCheckedAt: string | null
  lastError: string | null
  restartRequired: boolean
}

export type ManagedRuntime = {
  version: string
  executablePath: string
  platform: string
}

export class CodexRuntimeManager {
  private readonly root: string
  private readonly manifestPath: string
  private readonly target: PlatformTarget
  private manifest: CodexRuntimeManifest | null = null
  private checking: Promise<CodexRuntimeStatus> | null = null
  private readonly config: ServerConfig
  private readonly request: typeof fetch

  constructor(
    config: ServerConfig,
    request: typeof fetch = fetch,
    platform = process.platform,
    architecture = process.arch,
  ) {
    this.config = config
    this.request = request
    this.root = resolve(config.dataRoot, 'runtime')
    this.manifestPath = join(this.root, 'manifest.json')
    this.target = targetFor(platform, architecture)
  }

  async status(): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    return this.project(manifest)
  }

  /** Ensure a verified runtime exists before the HTTP server starts listening. */
  async ensureRuntime(): Promise<ManagedRuntime> {
    log.info(`Preparing Codex App Server runtime (${this.target.id})`)
    const manifest = await this.readManifest()
    if (
      manifest.active &&
      compatible(manifest.active.version) &&
      (!this.config.codexRuntimeVersion ||
        manifest.active.version === this.config.codexRuntimeVersion) &&
      (await this.validEntry(manifest.active))
    ) {
      log.success(`Using verified Codex App Server ${manifest.active.version} from local cache`)
      return {
        version: manifest.active.version,
        executablePath: manifest.active.executablePath,
        platform: manifest.active.platform,
      }
    }
    if (manifest.active)
      log.warn('Cached Codex App Server runtime is missing or failed integrity validation')

    const requested = this.config.codexRuntimeVersion
    const attempts = requested ? [requested] : ['latest', '0.153.0']
    log.info(
      requested
        ? `Runtime version lock is ${requested}; downloading only that version`
        : 'No runtime version lock; trying stable/latest then 0.153.0',
    )
    let lastError: unknown = null
    for (const attempt of attempts) {
      try {
        log.info(`Runtime attempt: ${attempt}`)
        if (attempt === 'latest') {
          manifest.candidate = null
          await this.writeManifest(manifest)
        }
        const status = await this.install(attempt === 'latest' ? undefined : attempt)
        const next = await this.readManifest()
        if (status.candidateStatus !== 'passed' || !next.candidate)
          throw new CodexRuntimeError(
            'CODEX_RUNTIME_VERIFICATION_FAILED',
            `Codex App Server ${attempt} failed protocol verification`,
          )
        next.previous = next.active
        next.active = next.candidate
        next.candidate = null
        next.restartRequired = false
        await this.writeManifest(next)
        log.success(`Codex App Server ${next.active.version} downloaded, verified, and activated`)
        return {
          version: next.active.version,
          executablePath: next.active.executablePath,
          platform: next.active.platform,
        }
      } catch (error) {
        lastError = error
        log.warn(`Runtime attempt ${attempt} failed: ${safeError(error)}`)
        if (requested) break
      }
    }
    throw new CodexRuntimeError(
      'CODEX_RUNTIME_REQUIRED',
      `No verified Codex App Server runtime is available. ${safeMessage(lastError)}`,
    )
  }

  async resolveCommand(): Promise<CodexCommand> {
    const manifest = await this.readManifest()
    if (!manifest.active || !(await this.validEntry(manifest.active)))
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_REQUIRED',
        'Download and verify a Codex App Server release before starting Codex',
      )
    return { executable: manifest.active.executablePath, args: ['--listen', 'stdio://'] }
  }

  async check(requestedVersion?: string | null): Promise<CodexRuntimeStatus> {
    if (this.checking) return this.checking
    this.checking = this.checkInternal(requestedVersion).finally(() => {
      this.checking = null
    })
    return this.checking
  }

  async install(version?: string): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    const requested = version ?? manifest.candidate?.version ?? manifest.requestedVersion
    log.info(
      `Looking up Codex App Server release${requested ? ` ${requested}` : ' (stable/latest)'}`,
    )
    const release = await this.releaseFor(requested ?? undefined)
    const releaseVersionValue = releaseVersion(release)
    if (!releaseVersionValue || !compatible(releaseVersionValue))
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_UNSUPPORTED',
        `Codex App Server ${releaseVersionValue ?? 'release'} is outside this Codex Web compatibility range`,
      )
    const asset = release.assets.find((entry) => entry.name === this.target.assetName)
    if (!asset)
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_UNSUPPORTED',
        `The ${releaseVersionValue} release has no ${this.target.id} App Server asset`,
      )
    const expectedHash = await this.expectedHash(release, asset)
    log.info(`Selected Codex App Server ${releaseVersionValue} asset for ${this.target.id}`)
    const staging = join(this.root, 'downloads', `${releaseVersionValue}-${randomUUID()}`)
    const destination = join(this.root, 'releases', releaseVersionValue, this.target.id)
    try {
      await mkdir(staging, { recursive: true })
      const archivePath = join(staging, asset.name)
      log.info(`Downloading Codex App Server ${releaseVersionValue}...`)
      const actualHash = await this.download(
        asset.browser_download_url,
        archivePath,
        releaseVersionValue,
      )
      log.info(`Download complete; validating SHA256 checksum`)
      if (actualHash !== expectedHash)
        throw new CodexRuntimeError(
          'CODEX_RUNTIME_VERIFICATION_FAILED',
          'Downloaded Codex App Server checksum did not match the official release',
        )
      await rm(destination, { recursive: true, force: true })
      await mkdir(destination, { recursive: true })
      const executablePath = await this.extractPackage(archivePath, destination)
      log.info(`Installed release payload; running executable and JSON-RPC smoke verification`)
      const executableHash = createHash('sha256')
        .update(await readFile(executablePath))
        .digest('hex')
      const candidate: CandidateEntry = {
        version: releaseVersionValue,
        platform: this.target.id,
        assetName: asset.name,
        executablePath,
        sha256: executableHash,
        discoveredAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
        verificationStatus: 'pending',
        verificationError: null,
      }
      manifest.candidate = candidate
      await this.writeManifest(manifest)
      try {
        await this.smokeVerify(candidate)
        candidate.verificationStatus = 'passed'
        log.success(
          `Codex App Server ${releaseVersionValue} passed version and protocol verification`,
        )
      } catch (error) {
        candidate.verificationStatus = 'failed'
        candidate.verificationError = safeMessage(error)
        log.error(
          `Codex App Server ${releaseVersionValue} verification failed: ${safeError(error)}`,
        )
      }
      manifest.candidate = candidate
      await this.writeManifest(manifest)
      return this.project(manifest)
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async activate(): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    const candidate = manifest.candidate
    if (
      !candidate ||
      candidate.verificationStatus !== 'passed' ||
      !(await this.validEntry(candidate))
    )
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_ACTIVATION_FAILED',
        'Only a successfully verified Codex App Server candidate can be activated',
      )
    manifest.previous = manifest.active
    manifest.active = candidate
    manifest.candidate = null
    manifest.restartRequired = true
    await this.writeManifest(manifest)
    await this.cleanup(manifest)
    return this.project(manifest)
  }

  async rollback(): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    if (!manifest.previous || !(await this.validEntry(manifest.previous)))
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_ACTIVATION_FAILED',
        'No verified runtime is available to roll back to',
      )
    const current = manifest.active
    manifest.active = manifest.previous
    manifest.previous = current
    manifest.restartRequired = true
    await this.writeManifest(manifest)
    return this.project(manifest)
  }

  async markRestarted() {
    const manifest = await this.readManifest()
    if (!manifest.restartRequired) return
    manifest.restartRequired = false
    await this.writeManifest(manifest)
  }

  private async checkInternal(requestedVersion?: string | null): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    if (requestedVersion !== undefined) {
      if (requestedVersion !== null && !isSafeVersion(requestedVersion))
        throw new CodexRuntimeError(
          'CODEX_RUNTIME_UNSUPPORTED',
          'Codex version must use major.minor.patch',
        )
      manifest.requestedVersion = requestedVersion
    }
    try {
      const release = await this.releaseFor(manifest.requestedVersion ?? undefined)
      const version = releaseVersion(release)
      if (!version || !compatible(version))
        throw new CodexRuntimeError(
          'CODEX_RUNTIME_UNSUPPORTED',
          `Codex App Server ${version ?? 'release'} is outside this Codex Web compatibility range`,
        )
      if (!release.assets.some((asset) => asset.name === this.target.assetName))
        throw new CodexRuntimeError(
          'CODEX_RUNTIME_UNSUPPORTED',
          `The ${version} release has no ${this.target.id} App Server asset`,
        )
      manifest.lastCheckedAt = new Date().toISOString()
      manifest.lastCheckError = null
      if (
        manifest.active?.version !== version &&
        (manifest.candidate?.version !== version ||
          manifest.candidate.platform !== this.target.id ||
          manifest.candidate.assetName !== this.target.assetName)
      ) {
        manifest.candidate = {
          version,
          platform: this.target.id,
          assetName: this.target.assetName,
          executablePath: '',
          sha256: '',
          discoveredAt: new Date().toISOString(),
          verifiedAt: '',
          verificationStatus: 'pending',
          verificationError: null,
        }
      }
    } catch (error) {
      manifest.lastCheckedAt = new Date().toISOString()
      manifest.lastCheckError = safeMessage(error)
    }
    await this.writeManifest(manifest)
    return this.project(manifest)
  }

  private async extractPackage(source: string, destination: string) {
    const buffer = gunzipSync(await readFile(source))
    let offset = 0
    const extracted = new Set<string>()
    while (offset + 512 <= buffer.length) {
      const header = buffer.subarray(offset, offset + 512)
      if (header.every((byte) => byte === 0)) break
      const name = tarString(header, 0, 100)
      const prefix = tarString(header, 345, 155)
      const rawEntryName = (prefix ? `${prefix}/${name}` : name).replaceAll('\\', '/')
      const size = tarNumber(header.subarray(124, 136))
      const type = String.fromCharCode(header[156] || 0)
      const contentOffset = offset + 512
      const nextOffset = contentOffset + Math.ceil(size / 512) * 512
      if (nextOffset > buffer.length)
        throw new Error('Codex runtime archive contains a truncated entry')
      const segments = rawEntryName.split('/')
      if (
        !rawEntryName ||
        rawEntryName.startsWith('/') ||
        rawEntryName.startsWith('\\') ||
        /^[A-Za-z]:(?:[\\/]|$)/.test(rawEntryName) ||
        segments.includes('..')
      )
        throw new Error('Codex runtime archive contains an unsafe entry')
      const entryName = segments.filter((segment) => segment && segment !== '.').join('/')
      if (!entryName) throw new Error('Codex runtime archive contains an invalid entry name')
      if (type === 'x' || type === 'g') {
        offset = nextOffset
        continue
      }
      const outputPath = join(destination, ...entryName.split('/'))
      if (!isPathWithin(outputPath, destination))
        throw new Error('Codex runtime archive contains an unsafe entry')
      if (type === '5') {
        await mkdir(outputPath, { recursive: true })
      } else if (type === '0' || type === '\0') {
        if (extracted.has(entryName))
          throw new Error('Codex runtime archive contains a duplicate entry')
        await mkdir(dirname(outputPath), { recursive: true })
        await writeFile(outputPath, buffer.subarray(contentOffset, contentOffset + size), {
          flag: 'wx',
          mode: 0o700,
        })
        await chmod(outputPath, 0o700).catch(() => undefined)
        extracted.add(entryName)
      } else {
        throw new Error('Codex runtime archive contains an unsupported entry type')
      }
      offset = nextOffset
    }
    const metadataPath = join(destination, 'codex-package.json')
    let metadata: unknown
    try {
      metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
    } catch {
      throw new Error('Codex runtime package has invalid metadata')
    }
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      (metadata as Record<string, unknown>).layoutVersion !== 1 ||
      (metadata as Record<string, unknown>).variant !== 'codex-app-server' ||
      (metadata as Record<string, unknown>).entrypoint !== `bin/${this.target.executableName}` ||
      (metadata as Record<string, unknown>).resourcesDir !== 'codex-resources' ||
      (metadata as Record<string, unknown>).pathDir !== 'codex-path'
    )
      throw new Error('Codex runtime package metadata does not match the selected target')
    const missing = this.target.requiredFiles.filter((relativePath) => {
      const filePath = join(destination, ...relativePath.split('/'))
      return !existsSync(filePath)
    })
    if (missing.length) throw new Error(`Codex runtime package is missing ${missing.join(', ')}`)
    return join(destination, 'bin', this.target.executableName)
  }
  private async releaseFor(version?: string): Promise<GitHubRelease> {
    const endpoint = version ? `${GITHUB_API}/tags/rust-v${version}` : `${GITHUB_API}/latest`
    const response = await this.requestWithDiagnostics(
      endpoint,
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codex-web-runtime' },
        signal: AbortSignal.timeout(20_000),
      },
      'GitHub release lookup',
    )
    if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`)
    const release = (await response.json()) as GitHubRelease
    if (release.draft || release.prerelease || !releaseVersion(release))
      throw new Error('GitHub did not return a stable Codex release')
    return release
  }

  private async expectedHash(release: GitHubRelease, asset: ReleaseAsset) {
    const fromDigest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? '')?.[1]?.toLowerCase()
    if (fromDigest) {
      log.info('Using SHA256 digest from GitHub release metadata')
      return fromDigest
    }
    const sums = release.assets.find((entry) => entry.name === 'codex-package_SHA256SUMS')
    if (!sums) throw new Error('Official release did not provide a checksum for this asset')
    log.info('GitHub release has no inline digest; downloading official SHA256SUMS manifest')
    const response = await this.requestWithDiagnostics(
      this.downloadUrl(sums.browser_download_url),
      {
        headers: { 'User-Agent': 'codex-web-runtime' },
        signal: AbortSignal.timeout(20_000),
      },
      'Official release checksum download',
    )
    if (!response.ok) throw new Error('Could not download official release checksums')
    const text = await response.text()
    const line = text.split(/\r?\n/).find((value) => value.trim().endsWith(`  ${asset.name}`))
    const match = /^([a-f0-9]{64})\s+/.exec(line?.trim() ?? '')
    if (!match) throw new Error('Official release checksums did not include the selected asset')
    return match[1].toLowerCase()
  }

  private async download(url: string, outputPath: string, version: string) {
    const response = await this.requestWithDiagnostics(
      this.downloadUrl(url),
      {
        headers: { Accept: 'application/octet-stream', 'User-Agent': 'codex-web-runtime' },
        redirect: 'follow',
        signal: AbortSignal.timeout(120_000),
      },
      'Codex runtime download',
    )
    if (!response.ok || !response.body)
      throw new Error(`Codex runtime download failed (${response.status})`)
    await mkdir(dirname(outputPath), { recursive: true })
    const hash = createHash('sha256')
    const stream = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })
    const total = Number(response.headers.get('content-length')) || null
    const interactive = process.stderr.isTTY
    const startedAt = Date.now()
    let downloaded = 0
    let lastRenderedAt = 0
    const render = (complete = false) => {
      if (!interactive || (!complete && Date.now() - lastRenderedAt < 100)) return
      lastRenderedAt = Date.now()
      const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.001)
      const rate = downloaded / elapsed
      const progress = total ? Math.min(downloaded / total, 1) : null
      const width = 28
      const filled =
        progress === null
          ? Math.floor((downloaded / 1_000_000) % (width + 1))
          : Math.round(progress * width)
      const bar = `${'='.repeat(Math.max(0, filled - 1))}${filled > 0 ? '>' : ''}${' '.repeat(width - filled)}`
      const percentage =
        progress === null ? ' --.-%' : `${(progress * 100).toFixed(1).padStart(5)}%`
      process.stderr.write(
        `\r\x1b[2K[INFO   ] Downloading Codex App Server ${version} [${bar}] ${percentage} ${formatBytes(downloaded)}${total ? `/${formatBytes(total)}` : ''} at ${formatBytes(rate)}/s`,
      )
      if (complete) process.stderr.write('\n')
    }
    try {
      const reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        hash.update(next.value)
        downloaded += next.value.byteLength
        render()
        if (!stream.write(next.value))
          await new Promise<void>((resolveDrain) => stream.once('drain', resolveDrain))
      }
      await new Promise<void>((resolveEnd, reject) => {
        stream.once('error', reject)
        stream.end(resolveEnd)
      })
      render(true)
      return hash.digest('hex')
    } catch (error) {
      if (interactive) process.stderr.write('\r\x1b[2K\n')
      stream.destroy()
      await rm(outputPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async requestWithDiagnostics(url: string, init: RequestInit, operation: string) {
    try {
      const response = await this.request(url, init)
      if (response.url && response.url !== url)
        log.info(`${operation} followed redirect to ${new URL(response.url).hostname}`)
      return response
    } catch (error) {
      const host = new URL(url).hostname
      throw new Error(`${operation} failed for ${host}: ${networkError(error)}`, { cause: error })
    }
  }

  private downloadUrl(value: string) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['github.com', 'api.github.com'].includes(url.hostname))
      throw new Error('Release asset URL is not an official GitHub HTTPS URL')
    return url.toString()
  }

  private async smokeVerify(entry: RuntimeEntry) {
    if (!(await this.validEntry(entry)))
      throw new Error('Downloaded App Server executable failed integrity validation')
    const home = join(tmpdir(), `codex-web-runtime-${randomUUID()}`)
    await mkdir(home, { recursive: true })
    try {
      const versionOutput = await run(entry.executablePath, ['--version'], { CODEX_HOME: home })
      if (!versionOutput.includes(entry.version))
        throw new Error('App Server version did not match the selected release')
      await verifyJsonRpc(entry.executablePath, entry.version, home)
    } finally {
      await rm(home, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async validEntry(entry: RuntimeEntry) {
    if (
      entry.platform !== this.target.id ||
      entry.assetName !== this.target.assetName ||
      !isPathWithin(entry.executablePath, this.root) ||
      !existsSync(entry.executablePath)
    )
      return false
    const executable = await stat(entry.executablePath).catch(() => null)
    if (!executable?.isFile()) return false
    const packageRoot = dirname(dirname(entry.executablePath))
    const expectedExecutable = join(packageRoot, 'bin', this.target.executableName)
    if (resolve(entry.executablePath) !== resolve(expectedExecutable)) return false
    for (const relativePath of this.target.requiredFiles) {
      const file = await stat(join(packageRoot, ...relativePath.split('/'))).catch(() => null)
      if (!file?.isFile()) return false
    }
    const hash = createHash('sha256')
      .update(await readFile(entry.executablePath))
      .digest('hex')
    return hash === entry.sha256
  }

  private async readManifest() {
    if (this.manifest) return this.manifest
    await mkdir(this.root, { recursive: true })
    try {
      this.manifest = safeManifest(JSON.parse(await readFile(this.manifestPath, 'utf8')), this.root)
    } catch {
      this.manifest = emptyManifest()
    }
    return this.manifest
  }

  private async writeManifest(manifest: CodexRuntimeManifest) {
    await mkdir(this.root, { recursive: true })
    const temporary = `${this.manifestPath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, this.manifestPath)
    this.manifest = manifest
  }

  private project(manifest: CodexRuntimeManifest): CodexRuntimeStatus {
    return {
      source: 'managed-release',
      platform: this.target.id,
      channel: 'stable',
      requestedVersion: manifest.requestedVersion,
      activeVersion: manifest.active?.version ?? null,
      candidateVersion: manifest.candidate?.version ?? null,
      candidateStatus: manifest.candidate?.verificationStatus ?? 'none',
      lastCheckedAt: manifest.lastCheckedAt,
      lastError: manifest.lastCheckError ?? manifest.candidate?.verificationError ?? null,
      restartRequired: manifest.restartRequired,
    }
  }

  private async cleanup(manifest: CodexRuntimeManifest) {
    const releases = join(this.root, 'releases')
    const keep = new Set([manifest.active?.version, manifest.previous?.version].filter(Boolean))
    const directories = await import('node:fs/promises')
      .then(({ readdir }) => readdir(releases, { withFileTypes: true }))
      .catch(() => [])
    await Promise.all(
      directories
        .filter((entry) => entry.isDirectory() && !keep.has(entry.name))
        .map((entry) => rm(join(releases, entry.name), { recursive: true, force: true })),
    )
  }
}

function tarString(buffer: Buffer, start: number, length: number) {
  return buffer
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/, '')
    .trim()
}

function tarNumber(buffer: Buffer) {
  const text = buffer.toString('ascii').replace(/\0.*$/, '').trim()
  const parsed = Number.parseInt(text || '0', 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('Codex runtime archive has an invalid entry size')
  return parsed
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Codex runtime operation failed'
}

function networkError(error: unknown) {
  if (!(error instanceof Error)) return 'unknown network error'
  const cause = error.cause
  if (cause && typeof cause === 'object') {
    const details = cause as { code?: unknown; message?: unknown }
    if (typeof details.code === 'string') return `${error.message} (${details.code})`
  }
  return error.message
}

function formatBytes(value: number) {
  if (value < 1024) return `${value.toFixed(0)} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${(value / 1024 ** 3).toFixed(2)} GiB`
}

function run(executable: string, args: string[], env: NodeJS.ProcessEnv) {
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

function verifyJsonRpc(executable: string, version: string, home: string) {
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
