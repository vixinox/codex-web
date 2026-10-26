import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(serverRoot, '../..')
const configuredDataRoot = process.env.CODEX_DATA_ROOT ?? '.data/codex'
const dataRoot = path.isAbsolute(configuredDataRoot)
  ? configuredDataRoot
  : path.resolve(workspaceRoot, configuredDataRoot)
mkdirSync(dataRoot, { recursive: true })

export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: path.join(dataRoot, 'owner.sqlite'),
  },
})
