import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: `${process.env.CODEX_DATA_ROOT ?? './.data/codex'}/owner.sqlite`,
  },
})
