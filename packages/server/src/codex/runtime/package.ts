import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { isPathWithin, type PlatformTarget, type RuntimeEntry } from '../runtime-policy.js'
import { run, verifyJsonRpc } from './smoke.js'

/** Stateless package operations; manifest transitions belong to RuntimeManager. */
export class RuntimePackage {
  private readonly root: string
  private readonly target: PlatformTarget
  constructor(root: string, target: PlatformTarget) {
    this.root = root
    this.target = target
  }
  async extractPackage(source: string, destination: string) {
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
  async validEntry(entry: RuntimeEntry) {
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

  async smokeVerify(entry: RuntimeEntry) {
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
