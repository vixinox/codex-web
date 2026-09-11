import { isAbsolute, relative, resolve } from 'node:path'

import { record } from './native-protocol.js'

export const SUPPORTED_CODEX_RANGE = { minimum: [0, 153, 0], maximum: [0, 153, 99] } as const
const MANIFEST_SCHEMA_VERSION = 2

export type PlatformTarget = {
  id: string
  assetName: string
  executableName: string
  requiredFiles: readonly string[]
}

export type RuntimeEntry = {
  version: string
  platform: string
  assetName: string
  executablePath: string
  sha256: string
  verifiedAt: string
}

export type CandidateEntry = RuntimeEntry & {
  discoveredAt: string
  verificationStatus: 'pending' | 'passed' | 'failed'
  verificationError: string | null
}

export type CodexRuntimeManifest = {
  schemaVersion: 2
  channel: 'stable'
  requestedVersion: string | null
  active: RuntimeEntry | null
  previous: RuntimeEntry | null
  candidate: CandidateEntry | null
  restartRequired: boolean
  lastCheckedAt: string | null
  lastCheckError: string | null
}

export class CodexRuntimeError extends Error {
  readonly code:
    | 'CODEX_RUNTIME_REQUIRED'
    | 'CODEX_RUNTIME_UNSUPPORTED'
    | 'CODEX_RUNTIME_VERIFICATION_FAILED'
    | 'CODEX_RUNTIME_ACTIVATION_FAILED'

  constructor(
    code:
      | 'CODEX_RUNTIME_REQUIRED'
      | 'CODEX_RUNTIME_UNSUPPORTED'
      | 'CODEX_RUNTIME_VERIFICATION_FAILED'
      | 'CODEX_RUNTIME_ACTIVATION_FAILED',
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

export function targetFor(
  platform = process.platform,
  architecture = process.arch,
): PlatformTarget {
  const targets: Record<string, PlatformTarget> = {
    'win32-x64': {
      id: 'windows-x64',
      assetName: 'codex-app-server-package-x86_64-pc-windows-msvc.tar.gz',
      executableName: 'codex-app-server.exe',
      requiredFiles: [
        'codex-package.json',
        'bin/codex-app-server.exe',
        'bin/codex-code-mode-host.exe',
        'codex-path/rg.exe',
        'codex-resources/codex-command-runner.exe',
        'codex-resources/codex-windows-sandbox-setup.exe',
      ],
    },
    'win32-arm64': {
      id: 'windows-arm64',
      assetName: 'codex-app-server-package-aarch64-pc-windows-msvc.tar.gz',
      executableName: 'codex-app-server.exe',
      requiredFiles: [
        'codex-package.json',
        'bin/codex-app-server.exe',
        'bin/codex-code-mode-host.exe',
        'codex-path/rg.exe',
        'codex-resources/codex-command-runner.exe',
        'codex-resources/codex-windows-sandbox-setup.exe',
      ],
    },
    'darwin-x64': {
      id: 'macos-x64',
      assetName: 'codex-app-server-package-x86_64-apple-darwin.tar.gz',
      executableName: 'codex-app-server',
      requiredFiles: [
        'codex-package.json',
        'bin/codex-app-server',
        'bin/codex-code-mode-host',
        'codex-path/rg',
        'codex-resources/zsh/bin/zsh',
      ],
    },
    'darwin-arm64': {
      id: 'macos-arm64',
      assetName: 'codex-app-server-package-aarch64-apple-darwin.tar.gz',
      executableName: 'codex-app-server',
      requiredFiles: [
        'codex-package.json',
        'bin/codex-app-server',
        'bin/codex-code-mode-host',
        'codex-path/rg',
        'codex-resources/zsh/bin/zsh',
      ],
    },
    'linux-x64': {
      id: 'linux-x64',
      assetName: 'codex-app-server-package-x86_64-unknown-linux-musl.tar.gz',
      executableName: 'codex-app-server',
      requiredFiles: [
        'codex-package.json',
        'bin/codex-app-server',
        'bin/codex-code-mode-host',
        'codex-path/rg',
        'codex-resources/bwrap',
        'codex-resources/zsh/bin/zsh',
      ],
    },
    'linux-arm64': {
      id: 'linux-arm64',
      assetName: 'codex-app-server-package-aarch64-unknown-linux-musl.tar.gz',
      executableName: 'codex-app-server',
      requiredFiles: [
        'codex-package.json',
        'bin/codex-app-server',
        'bin/codex-code-mode-host',
        'codex-path/rg',
        'codex-resources/bwrap',
        'codex-resources/zsh/bin/zsh',
      ],
    },
  }
  const target = targets[`${platform}-${architecture}`]
  if (!target)
    throw new CodexRuntimeError(
      'CODEX_RUNTIME_UNSUPPORTED',
      `Codex App Server is not supported on ${platform}/${architecture}`,
    )
  return target
}

export function emptyManifest(): CodexRuntimeManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    channel: 'stable',
    requestedVersion: null,
    active: null,
    previous: null,
    candidate: null,
    restartRequired: false,
    lastCheckedAt: null,
    lastCheckError: null,
  }
}

export function parseVersion(value: string): number[] | null {
  const matched = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  return matched ? matched.slice(1).map(Number) : null
}

export function releaseVersion(release: { tag_name: string }): string | null {
  const matched = /^rust-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)
  return matched ? matched[1] : null
}

export function compatible(version: string) {
  const parsed = parseVersion(version)
  if (!parsed) return false
  const compare = (left: number[], right: readonly number[]) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index]
    }
    return 0
  }
  return (
    compare(parsed, SUPPORTED_CODEX_RANGE.minimum) >= 0 &&
    compare(parsed, SUPPORTED_CODEX_RANGE.maximum) <= 0
  )
}

export function isSafeVersion(value: unknown): value is string {
  return typeof value === 'string' && parseVersion(value) !== null
}

export function isPathWithin(path: string, root: string) {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const difference = relative(resolvedRoot, resolvedPath)
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference))
}

function safeRuntimeEntry(value: unknown, root: string): RuntimeEntry | null {
  if (!record(value)) return null
  const version = value.version
  const platform = value.platform
  const assetName = value.assetName
  const executablePath = value.executablePath
  const sha256 = value.sha256
  const verifiedAt = value.verifiedAt
  if (
    !isSafeVersion(version) ||
    typeof platform !== 'string' ||
    typeof assetName !== 'string' ||
    typeof executablePath !== 'string' ||
    typeof sha256 !== 'string' ||
    typeof verifiedAt !== 'string' ||
    !isPathWithin(executablePath, root)
  )
    return null
  return { version, platform, assetName, executablePath, sha256, verifiedAt }
}

function safeCandidate(value: unknown, root: string): CandidateEntry | null {
  if (!record(value)) return null
  const version = value.version
  const platform = value.platform
  const assetName = value.assetName
  const discoveredAt = value.discoveredAt
  const verificationStatus = value.verificationStatus
  if (
    !isSafeVersion(version) ||
    typeof platform !== 'string' ||
    typeof assetName !== 'string' ||
    typeof discoveredAt !== 'string' ||
    (verificationStatus !== 'pending' &&
      verificationStatus !== 'passed' &&
      verificationStatus !== 'failed')
  )
    return null
  if (verificationStatus === 'pending' && value.executablePath === '' && value.sha256 === '')
    return {
      version,
      platform,
      assetName,
      executablePath: '',
      sha256: '',
      discoveredAt,
      verifiedAt: '',
      verificationStatus: 'pending',
      verificationError: null,
    }
  const entry = safeRuntimeEntry(value, root)
  if (!entry) return null
  return {
    ...entry,
    discoveredAt,
    verificationStatus,
    verificationError: typeof value.verificationError === 'string' ? value.verificationError : null,
  }
}

export function safeManifest(value: unknown, root: string): CodexRuntimeManifest {
  if (!record(value)) return emptyManifest()
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION || value.channel !== 'stable')
    return emptyManifest()
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    channel: 'stable',
    requestedVersion: isSafeVersion(value.requestedVersion) ? value.requestedVersion : null,
    active: safeRuntimeEntry(value.active, root),
    previous: safeRuntimeEntry(value.previous, root),
    candidate: safeCandidate(value.candidate, root),
    restartRequired: value.restartRequired === true,
    lastCheckedAt: typeof value.lastCheckedAt === 'string' ? value.lastCheckedAt : null,
    lastCheckError: typeof value.lastCheckError === 'string' ? value.lastCheckError : null,
  }
}
