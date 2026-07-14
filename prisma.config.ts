import { defineConfig } from 'prisma/config'

process.loadEnvFile()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
})
