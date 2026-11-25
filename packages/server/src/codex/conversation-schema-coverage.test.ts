import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

type VendorSchema = {
  definitions?: Record<string, VendorSchema>
  oneOf?: { properties?: Record<string, { enum?: unknown }> }[]
}

type CoverageCatalog = {
  schemaVersion: string
  threadItems: string[]
  threadRealtimeItems: string[]
  serverRequests: string[]
  serverNotifications: Record<string, string[]>
}

const repo = new URL('../../../../', import.meta.url)
const vendor = new URL('docs/vendor/codex-app-server/0.167.0/', repo)
const coverage = JSON.parse(
  readFileSync(new URL('./fixtures/conversation-schema-coverage.json', import.meta.url), 'utf8'),
) as CoverageCatalog

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

assert.equal(coverage.schemaVersion, '0.167.0')
assert.deepEqual(new Set(Object.keys(coverage.serverNotifications)), notificationGroups)

const itemSchemas = readSchema('codex_app_server_protocol.v2.schemas.json').definitions

for (const { name, schema, discriminator, documented } of [
  {
    name: 'ThreadItem',
    schema: itemSchemas?.ThreadItem,
    discriminator: 'type',
    documented: coverage.threadItems,
  },
  {
    name: 'ThreadRealtimeItem',
    schema: itemSchemas?.ThreadRealtimeItem,
    discriminator: 'type',
    documented: coverage.threadRealtimeItems,
  },
  {
    name: 'ServerNotification',
    schema: readSchema('ServerNotification.json'),
    discriminator: 'method',
    documented: Object.values(coverage.serverNotifications).flat(),
  },
  {
    name: 'ServerRequest',
    schema: readSchema('ServerRequest.json'),
    discriminator: 'method',
    documented: coverage.serverRequests,
  },
] as const) {
  test(`0.167.0 ${name}: coverage catalog accounts for every schema member once`, () => {
    const official = schemaNames(schema, discriminator)
    assert.equal(new Set(documented).size, documented.length, `Duplicate ${name} catalog entry`)
    assert.equal(
      new Set(official).size,
      official.length,
      `Duplicate official ${name} discriminator`,
    )
    assert.deepEqual(documented.toSorted(), official.toSorted(), `Catalog mismatch for ${name}`)
  })
}
