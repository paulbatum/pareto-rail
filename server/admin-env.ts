import fs from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

export type AdminEnvironment = 'local' | 'prod';

type AdminDatabase = {
  prisma: PrismaClient;
  participantSalt: string;
};

const databases = new Map<AdminEnvironment, AdminDatabase>();

export class AdminEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminEnvironmentError';
  }
}

/** Reads an admin database configuration without changing process.env. */
export function getAdminDatabase(environment: AdminEnvironment): AdminDatabase {
  const cached = databases.get(environment);
  if (cached) return cached;

  const fileName = environment === 'local' ? '.env' : '.env.prod';
  const values = readEnvFile(fileName, environment === 'local');
  const databaseUrl = values.DATABASE_URL;
  const participantSalt = values.PARTICIPANT_SALT;
  const missing = [
    ...(databaseUrl ? [] : ['DATABASE_URL']),
    ...(participantSalt ? [] : ['PARTICIPANT_SALT']),
  ];
  if (missing.length > 0) {
    throw new AdminEnvironmentError(`${environment} admin environment is missing ${missing.join(' and ')} in ${fileName}`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
  });
  const database = { prisma, participantSalt };
  databases.set(environment, database);
  return database;
}

function readEnvFile(fileName: string, fallbackToProcessEnv: boolean): Record<string, string> {
  const filePath = path.resolve(process.cwd(), fileName);
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isMissingFile(error) && fallbackToProcessEnv) {
      return processEnvValues();
    }
    if (isMissingFile(error)) {
      throw new AdminEnvironmentError(`${fileName} was not found`);
    }
    throw new AdminEnvironmentError(`Could not read ${fileName}`);
  }
  return parseEnv(contents);
}

function parseEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function processEnvValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ['DATABASE_URL', 'PARTICIPANT_SALT']) {
    const value = process.env[key];
    if (value !== undefined) values[key] = value;
  }
  return values;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}
