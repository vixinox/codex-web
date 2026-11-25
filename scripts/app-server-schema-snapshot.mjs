import { randomUUID } from 'node:crypto'
import { access, copyFile, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'

const SNAPSHOT_METADATA = 'codex-schema-snapshot.json'
const CURRENT_POINTER = 'current-version.txt'
const REQUIRED_SCHEMAS = [
  'codex_app_server_protocol.schemas.json',
  'codex_app_server_protocol.v2.schemas.json',
  'ClientRequest.json',
  'ServerRequest.json',
  'ServerNotification.json',
]

export function compareReviewedCoverage(latestSchemas, catalog) {
  const latest = extractCoverageMembers(latestSchemas)
  const reviewed = {
    ThreadItem: catalog.threadItems,
    ThreadRealtimeItem: catalog.threadRealtimeItems,
    ServerRequest: catalog.serverRequests,
    ServerNotification: Object.values(catalog.serverNotifications).flat(),
  }
  return Object.fromEntries(
    Object.keys(reviewed).map((name) => {
      const oldMembers = new Set(reviewed[name])
      const currentMembers = new Set(latest[name] ?? [])
      return [
        name,
        {
          added: [...currentMembers]
            .filter((member) => !oldMembers.has(member))
            .sort((left, right) => left.localeCompare(right)),
          removed: [...oldMembers]
            .filter((member) => !currentMembers.has(member))
            .sort((left, right) => left.localeCompare(right)),
        },
      ]
    }),
  )
}

export async function validateGeneratedSchemas(directory, version) {
  const files = await listFiles(directory)
  await Promise.all(
    REQUIRED_SCHEMAS.map(async (required) => {
      if (!files.includes(required)) throw new Error(`Generated schema set is missing ${required}`)
      const value = await readJson(join(directory, required))
      if (!value || typeof value !== 'object')
        throw new Error(`Generated schema ${required} is invalid`)
    }),
  )
  const flat = await readJson(join(directory, 'codex_app_server_protocol.schemas.json'))
  const v2 = await readJson(join(directory, 'codex_app_server_protocol.v2.schemas.json'))
  if (!flat.definitions || !v2.definitions)
    throw new Error(`Generated JSON Schema bundles for ${version} have no definitions`)
  return files
}

export async function readSchemaSet(directory) {
  const v2 = await readJson(join(directory, 'codex_app_server_protocol.v2.schemas.json'))
  const schemas = {
    ThreadItem: v2.definitions?.ThreadItem,
    ThreadRealtimeItem: v2.definitions?.ThreadRealtimeItem,
    ServerRequest: await readJson(join(directory, 'ServerRequest.json')),
    ServerNotification: await readJson(join(directory, 'ServerNotification.json')),
  }
  requireUnion(schemas.ThreadItem, 'type', 'ThreadItem')
  requireUnion(schemas.ThreadRealtimeItem, 'type', 'ThreadRealtimeItem')
  requireUnion(schemas.ServerRequest, 'method', 'ServerRequest')
  requireUnion(schemas.ServerNotification, 'method', 'ServerNotification')
  return schemas
}

export function reportDifferences(differences, log) {
  const changes = Object.entries(differences).filter(
    ([, difference]) => difference.added.length || difference.removed.length,
  )
  if (!changes.length) {
    log('Schema union members match the reviewed Conversation coverage catalog.')
    return
  }
  log('Schema coverage review required; these diffs were not added to the reviewed catalog:')
  for (const [name, difference] of changes) {
    if (difference.added.length) log(`  ${name} added: ${difference.added.join(', ')}`)
    if (difference.removed.length) log(`  ${name} removed: ${difference.removed.join(', ')}`)
  }
}

export async function publishSnapshot({ snapshotPath, stagingPath, generatedFiles }) {
  if (await fileExists(snapshotPath)) {
    const existing = await listFiles(snapshotPath, SNAPSHOT_METADATA)
    const samePaths =
      existing.length === generatedFiles.length &&
      existing.every((file, index) => file === generatedFiles[index])
    if (!samePaths)
      throw new Error(
        `Snapshot ${basename(snapshotPath)} already exists with different files; refusing to overwrite it`,
      )
    const mismatches = await Promise.all(
      generatedFiles.map(async (file) => {
        const [existingContent, generatedContent] = await Promise.all([
          readFile(join(snapshotPath, file)),
          readFile(join(stagingPath, file)),
        ])
        return existingContent.equals(generatedContent) ? undefined : file
      }),
    )
    const mismatch = mismatches.find(Boolean)
    if (mismatch)
      throw new Error(`Snapshot ${basename(snapshotPath)} is immutable and differs at ${mismatch}`)
    await copyFile(join(stagingPath, SNAPSHOT_METADATA), join(snapshotPath, SNAPSHOT_METADATA))
    return false
  }
  await rename(stagingPath, snapshotPath)
  return true
}

export async function writeCurrentPointer(schemaRoot, version) {
  const pointer = join(schemaRoot, CURRENT_POINTER)
  const temporary = `${pointer}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${version}\n`)
    await rename(temporary, pointer)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function extractCoverageMembers(schemas) {
  return {
    ThreadItem: unionNames(schemas.ThreadItem, 'type'),
    ThreadRealtimeItem: unionNames(schemas.ThreadRealtimeItem, 'type'),
    ServerRequest: unionNames(schemas.ServerRequest, 'method'),
    ServerNotification: unionNames(schemas.ServerNotification, 'method'),
  }
}

function unionNames(schema, discriminator) {
  return (schema?.oneOf ?? [])
    .map((branch) => branch.properties?.[discriminator]?.enum)
    .filter((value) => Array.isArray(value) && value.length === 1 && typeof value[0] === 'string')
    .map((value) => value[0])
}

function requireUnion(schema, discriminator, name) {
  if (!Array.isArray(schema?.oneOf) || schema.oneOf.length === 0)
    throw new Error(`Generated schema is missing the ${name} union`)
  for (const [index, branch] of schema.oneOf.entries()) {
    const values = branch.properties?.[discriminator]?.enum
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string')
      throw new Error(`Generated ${name} union branch ${index} has no ${discriminator}`)
  }
}

async function listFiles(directory, ignoredName) {
  async function visit(current, relative = '') {
    const entries = await readdir(current, { withFileTypes: true })
    const children = entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .filter((entry) => entry.name !== ignoredName)
    const nested = await Promise.all(
      children.map(async (entry) => {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name
        const childPath = join(current, entry.name)
        if (entry.isDirectory()) return visit(childPath, childRelative)
        if (entry.isFile()) return childRelative
        throw new Error(`Generated schema contains an unsupported file entry: ${childRelative}`)
      }),
    )
    return nested.flat()
  }
  return visit(directory)
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
