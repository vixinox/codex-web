import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { ServerConfig } from '../config.js'
import { log } from '../logger.js'
import { RuntimePackage } from './runtime/package.js'
import { RuntimeReleaseClient } from './runtime/release.js'
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
  log.info('codex.runtime.proxy-enabled')
}

import {
  CodexRuntimeError,
  emptyManifest,
  isSafeVersion,
  releaseVersion,
  safeManifest,
  targetFor,
  type CandidateEntry,
  type PlatformTarget,
  type CodexRuntimeManifest,
} from './runtime-policy.js'

export type { CodexRuntimeManifest } from './runtime-policy.js'
export { CodexRuntimeError, targetFor } from './runtime-policy.js'

function errorType(error: unknown) {
  return error instanceof Error
    ? error.name.replace(/[^A-Za-z0-9]/gu, '').slice(0, 48)
    : typeof error
}

export type CodexRuntimeStatus = {
  source: 'managed-release' | 'explicit-command'
  platform: string
  channel: 'stable'
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
  private readonly releases: RuntimeReleaseClient
  private readonly package: RuntimePackage

  constructor(
    config: ServerConfig,
    request: typeof fetch = fetch,
    platform = process.platform,
    architecture = process.arch,
  ) {
    this.root = resolve(config.dataRoot, 'runtime')
    this.manifestPath = join(this.root, 'manifest.json')
    this.target = targetFor(platform, architecture)
    this.releases = new RuntimeReleaseClient(request)
    this.package = new RuntimePackage(this.root, this.target)
  }

  async status(): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    return this.project(manifest)
  }

  /** Ensure a verified runtime exists before the HTTP server starts listening. */
  async ensureRuntime(): Promise<ManagedRuntime> {
    log.info('codex.runtime.preparing', { platform: this.target.id })
    const manifest = await this.readManifest()
    if (
      manifest.active &&
      isSafeVersion(manifest.active.version) &&
      (await this.package.validEntry(manifest.active))
    ) {
      try {
        const latest = await this.check()
        if (latest.candidateVersion && latest.candidateVersion !== manifest.active.version) {
          const installed = await this.install()
          if (installed.candidateStatus === 'passed') {
            const activated = await this.activate()
            if (activated.activeVersion) {
              const active = await this.readManifest()
              if (active.active) return { ...active.active }
            }
          }
        }
      } catch (error) {
        log.warn('codex.runtime.latest-check-failed', { errorType: errorType(error) })
      }
      const active = await this.readManifest()
      if (active.active && (await this.package.validEntry(active.active))) {
        log.info('codex.runtime.cache-selected', { version: active.active.version })
        return { ...active.active }
      }
    }
    if (manifest.active) log.warn('codex.runtime.cached-entry-invalid')

    let lastError: unknown = null
    try {
      log.info('codex.runtime.download-required')
      manifest.candidate = null
      await this.writeManifest(manifest)
      const status = await this.install()
      const next = await this.readManifest()
      if (status.candidateStatus !== 'passed' || !next.candidate)
        throw new CodexRuntimeError(
          'CODEX_RUNTIME_VERIFICATION_FAILED',
          'Latest Codex App Server release failed protocol verification',
        )
      next.previous = next.active
      next.active = next.candidate
      next.candidate = null
      next.restartRequired = false
      await this.writeManifest(next)
      log.info('codex.runtime.activated', { version: next.active.version })
      return {
        version: next.active.version,
        executablePath: next.active.executablePath,
        platform: next.active.platform,
      }
    } catch (error) {
      lastError = error
      log.warn('codex.runtime.latest-attempt-failed', { errorType: errorType(error) })
    }
    throw new CodexRuntimeError(
      'CODEX_RUNTIME_REQUIRED',
      `No verified Codex App Server runtime is available. ${safeMessage(lastError)}`,
    )
  }

  async resolveCommand(): Promise<CodexCommand> {
    const manifest = await this.readManifest()
    if (!manifest.active || !(await this.package.validEntry(manifest.active)))
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_REQUIRED',
        'Download and verify a Codex App Server release before starting Codex',
      )
    return { executable: manifest.active.executablePath, args: ['--listen', 'stdio://'] }
  }

  async check(): Promise<CodexRuntimeStatus> {
    if (this.checking) return this.checking
    this.checking = this.checkInternal().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  async install(): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    log.info('codex.runtime.release-lookup-started')
    const release = await this.releases.releaseFor(undefined)
    const releaseVersionValue = releaseVersion(release)
    if (!releaseVersionValue)
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_UNSUPPORTED',
        'Latest Codex App Server release has an invalid version',
      )
    const asset = release.assets.find((entry) => entry.name === this.target.assetName)
    if (!asset)
      throw new CodexRuntimeError(
        'CODEX_RUNTIME_UNSUPPORTED',
        `The ${releaseVersionValue} release has no ${this.target.id} App Server asset`,
      )
    const expectedHash = await this.releases.expectedHash(release, asset)
    log.info('codex.runtime.asset-selected', {
      version: releaseVersionValue,
      platform: this.target.id,
    })
    const staging = join(this.root, 'downloads', `${releaseVersionValue}-${randomUUID()}`)
    const destination = join(this.root, 'releases', releaseVersionValue, this.target.id)
    try {
      await mkdir(staging, { recursive: true })
      const archivePath = join(staging, asset.name)
      log.info('codex.runtime.download-started', { version: releaseVersionValue })
      const actualHash = await this.releases.download(
        asset.browser_download_url,
        archivePath,
        releaseVersionValue,
      )
      log.info('codex.runtime.download-completed')
      if (actualHash !== expectedHash)
        throw new CodexRuntimeError(
          'CODEX_RUNTIME_VERIFICATION_FAILED',
          'Downloaded Codex App Server checksum did not match the official release',
        )
      await rm(destination, { recursive: true, force: true })
      await mkdir(destination, { recursive: true })
      const executablePath = await this.package.extractPackage(archivePath, destination)
      log.info('codex.runtime.verification-started', { version: releaseVersionValue })
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
        await this.package.smokeVerify(candidate)
        candidate.verificationStatus = 'passed'
        log.info('codex.runtime.verification-passed', { version: releaseVersionValue })
      } catch (error) {
        candidate.verificationStatus = 'failed'
        candidate.verificationError = safeMessage(error)
        log.error('codex.runtime.verification-failed', {
          version: releaseVersionValue,
          errorType: errorType(error),
        })
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
      !(await this.package.validEntry(candidate))
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
    if (!manifest.previous || !(await this.package.validEntry(manifest.previous)))
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

  private async checkInternal(): Promise<CodexRuntimeStatus> {
    const manifest = await this.readManifest()
    try {
      const release = await this.releases.releaseFor(undefined)
      const version = releaseVersion(release)
      if (!version)
        throw new CodexRuntimeError(
          'CODEX_RUNTIME_UNSUPPORTED',
          'Latest Codex App Server release has an invalid version',
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

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Codex runtime operation failed'
}
