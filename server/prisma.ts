import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

let client: PrismaClient | undefined;

/** One small pool per serverless instance avoids opening a connection per request. */
export function getPrismaClient(): PrismaClient {
  if (client) return client;
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  const adapter = new PrismaPg({ connectionString, max: 2 });
  client = new PrismaClient({ adapter });
  return client;
}

function loadLocalEnv(): void {
  if (process.env.DATABASE_URL || typeof process.loadEnvFile !== 'function') return;
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}
