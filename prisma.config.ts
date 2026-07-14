import { defineConfig } from 'prisma/config'

// PRISMA_ENV_FILE=.env.prod switches CLI commands (e.g. migrate deploy) to the production database.
try {
  process.loadEnvFile(process.env.PRISMA_ENV_FILE ?? '.env')
} catch (error) {
  if (!(typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')) throw error
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
})
