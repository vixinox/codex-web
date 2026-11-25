import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { releaseVersion } from '../runtime-policy.js'
import { log } from '../../logger.js'

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

/** Owns external release I/O, without access to the runtime manifest. */
export class RuntimeReleaseClient {
  private readonly request: typeof fetch
  constructor(request: typeof fetch) {
    this.request = request
  }
  async releaseFor(version?: string): Promise<GitHubRelease> {
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

  async expectedHash(release: GitHubRelease, asset: ReleaseAsset) {
    const fromDigest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? '')?.[1]?.toLowerCase()
    if (fromDigest) {
      log.info('codex.runtime.digest-from-release-metadata')
      return fromDigest
    }
    const sums = release.assets.find((entry) => entry.name === 'codex-package_SHA256SUMS')
    if (!sums) throw new Error('Official release did not provide a checksum for this asset')
    log.info('codex.runtime.digest-manifest-required')
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

  async download(url: string, outputPath: string, version: string) {
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
        log.info('codex.runtime.download-redirected', {
          operation,
          host: new URL(response.url).hostname,
        })
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
