import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

type VendorSchema = {
  definitions?: Record<string, VendorSchema>
  oneOf?: { properties?: Record<string, { enum?: unknown }> }[]
}

const docs = new URL('../../../../docs/', import.meta.url)
const vendor = new URL('vendor/codex-app-server/0.167.0/', docs)
const matrix = readFileSync(new URL('impl/conversation-model/schema-coverage.md', docs), 'utf8')

function readSchema(file: string): VendorSchema {
  return JSON.parse(readFileSync(new URL(file, vendor), 'utf8')) as VendorSchema
}

function schemaNames(schema: VendorSchema | undefined, discriminator: 'type' | 'method') {
  assert.ok(schema?.oneOf, `Expected a oneOf union for ${discriminator}`)
  return schema.oneOf.map((branch, index) => {
    const values = branch.properties?.[discriminator]?.enum
    assert.ok(
      Array.isArray(values) && values.length === 1,
      `Expected one ${discriminator} for branch ${index}`,
    )
    const name: unknown = values[0]
    assert.ok(
      typeof name === 'string' && name.length > 0,
      `Invalid ${discriminator} for branch ${index}`,
    )
    return name
  })
}

const notificationGroups = new Set([
  'Conversation error/status',
  'Turn / hooks',
  'Item lifecycle / output',
  'Review / model / guardrail',
  'MCP runtime',
  'Thread realtime/audio',
  'Account/runtime/workspace',
  'Runtime notices',
])

function documentedNames(section: string, columns: number) {
  const sections = matrix.split(/^## /m).filter((part) => part.startsWith(`${section}\uFF08`))
  assert.equal(sections.length, 1, `Expected one ${section} section in the coverage matrix`)
  const rows = sections[0]!
    .split(/\r?\n/)
    .filter((line) => line.startsWith('|'))
    .slice(2)
  const grouped = section === 'ServerNotification'
  const seenGroups = new Set<string>()

  const names = rows.flatMap((row) => {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    assert.equal(cells.length, columns, `Unexpected column count in ${section}: ${row}`)
    const [first, second, ...notes] = cells
    const entries = (grouped ? second! : first!).split(',').map((entry) => {
      const name = /^`([^`\s]+)`$/.exec(entry.trim())?.[1]
      assert.ok(name, `Expected a catalog name in ${section}: ${entry}`)
      return name
    })

    if (grouped) {
      assert.ok(first && notificationGroups.has(first), `Unknown notification group: ${first}`)
      assert.ok(!seenGroups.has(first), `Duplicate notification group: ${first}`)
      seenGroups.add(first)
    } else {
      assert.equal(entries.length, 1, `Expected one name per ${section} row`)
    }

    for (const note of grouped ? notes : [second!, ...notes]) {
      assert.match(note, /\p{L}/u, `Missing coverage note in ${section}: ${row}`)
    }
    return entries
  })

  if (grouped) assert.deepEqual(seenGroups, notificationGroups)
  return names
}

const itemSchemas = readSchema('codex_app_server_protocol.v2.schemas.json').definitions

for (const { name, schema, discriminator, count, columns } of [
  {
    name: 'ThreadItem',
    schema: itemSchemas?.ThreadItem,
    discriminator: 'type',
    count: 19,
    columns: 5,
  },
  {
    name: 'ThreadRealtimeItem',
    schema: itemSchemas?.ThreadRealtimeItem,
    discriminator: 'type',
    count: 4,
    columns: 3,
  },
  {
    name: 'ServerNotification',
    schema: readSchema('ServerNotification.json'),
    discriminator: 'method',
    count: 86,
    columns: 3,
  },
  {
    name: 'ServerRequest',
    schema: readSchema('ServerRequest.json'),
    discriminator: 'method',
    count: 10,
    columns: 4,
  },
] as const) {
  test(`0.167.0 ${name}: documented catalog accounts for every schema member once`, () => {
    const official = schemaNames(schema, discriminator)
    const documented = documentedNames(name, columns)

    assert.equal(official.length, count, `Unexpected number of official ${name} branches`)
    assert.equal(
      new Set(official).size,
      official.length,
      `Duplicate official ${name} discriminator`,
    )
    assert.deepEqual(documented.sort(), official.sort(), `Catalog mismatch for ${name}`)
  })
}
