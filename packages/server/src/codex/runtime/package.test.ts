import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import test from 'node:test'

import { RuntimePackage } from './package.js'
import { targetFor } from '../runtime-policy.js'

function archive(entries: Array<{ name: string; content: string; type?: string }>) {
  const blocks: Buffer[] = []
  for (const { name, content, type = '0' } of entries) {
    const header = Buffer.alloc(512)
    header.write(name, 0, 100, 'utf8')
    header.write(Buffer.byteLength(content).toString(8).padStart(11, '0'), 124, 11, 'ascii')
    header.write(type, 156, 1, 'ascii')
    const body = Buffer.alloc(Math.ceil(Buffer.byteLength(content) / 512) * 512)
    body.write(content)
    blocks.push(header, body)
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

test('runtime package extraction preserves required files and integrity rejects later tampering', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-runtime-package-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const target = targetFor('win32', 'x64')
  const destination = join(root, 'package')
  const source = join(root, 'release.tar.gz')
  await mkdir(destination)
  const metadata = JSON.stringify({
    layoutVersion: 1,
    variant: 'codex-app-server',
    entrypoint: `bin/${target.executableName}`,
    resourcesDir: 'codex-resources',
    pathDir: 'codex-path',
  })
  await writeFile(
    source,
    archive(
      target.requiredFiles.map((name) => ({
        name,
        content: name === 'codex-package.json' ? metadata : 'synthetic runtime',
      })),
    ),
  )
  const runtime = new RuntimePackage(root, target)
  const executablePath = await runtime.extractPackage(source, destination)
  const entry = {
    platform: target.id,
    assetName: target.assetName,
    version: '0.200.0',
    executablePath,
    sha256: createHash('sha256')
      .update(await readFile(executablePath))
      .digest('hex'),
    verifiedAt: new Date().toISOString(),
  }
  assert.equal(await runtime.validEntry(entry), true)
  await writeFile(executablePath, 'tampered')
  assert.equal(await runtime.validEntry(entry), false)
})

test('runtime extraction rejects traversal and link entries before writing outside the package', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-runtime-archive-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const destination = join(root, 'package')
  await mkdir(destination)
  const runtime = new RuntimePackage(root, targetFor('win32', 'x64'))
  for (const entry of [
    { name: '../escape', content: 'invalid' },
    { name: 'link', content: '', type: '2' },
  ]) {
    const source = join(root, 'release.tar.gz')
    await writeFile(source, archive([entry]))
    await assert.rejects(
      runtime.extractPackage(source, destination),
      /unsafe entry|unsupported entry type/,
    )
  }
  await assert.rejects(readFile(join(root, 'escape')), { code: 'ENOENT' })
})
