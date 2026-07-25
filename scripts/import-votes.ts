// Replaces the local vote database with a snapshot written by scripts/export-votes.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAdminDatabase, AdminEnvironmentError } from '../server/admin-env.ts';
import { RankDataClass, RankRelative, RankSentiment, RankVerdict } from '../src/generated/prisma/client.js';

const OUTPUT_DIR = path.resolve(process.cwd(), 'benchmark/private/votes');

const verdictFromWire = {
  'a-better': RankVerdict.A_BETTER,
  'b-better': RankVerdict.B_BETTER,
  'both-good': RankVerdict.BOTH_GOOD,
  'both-bad': RankVerdict.BOTH_BAD,
} as const;

const relativeFromWire = { a: RankRelative.A, b: RankRelative.B, tie: RankRelative.TIE } as const;
const sentimentFromWire = { positive: RankSentiment.POSITIVE, negative: RankSentiment.NEGATIVE } as const;
const dataClassFromWire = {
  eligible: RankDataClass.ELIGIBLE,
  rehearsal: RankDataClass.REHEARSAL,
  development: RankDataClass.DEVELOPMENT,
} as const;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg.startsWith('--env'))) {
    throw new Error('This script only ever targets the local database, so --env is not accepted.');
  }
  const snapshotPath = await resolveSnapshot(args.filter((arg) => !arg.startsWith('--')));
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  if (!Array.isArray(snapshot?.matchups) || !Array.isArray(snapshot?.votes)) {
    throw new Error(`${path.relative(process.cwd(), snapshotPath)} is not a vote snapshot`);
  }

  // Only ever writes to the local database; production restores are not a workflow this repo supports.
  const { prisma, databaseUrl } = getAdminDatabase('local');
  assertLoopbackDatabase(databaseUrl);
  const matchups = snapshot.matchups.map((matchup: Record<string, unknown>) => ({
    ...matchup,
    createdAt: new Date(matchup.createdAt as string),
  }));
  const votes = snapshot.votes.map((vote: Record<string, unknown>) => ({
    ...vote,
    verdict: lookup(verdictFromWire, vote.verdict, 'verdict'),
    relative: lookup(relativeFromWire, vote.relative, 'relative'),
    sentiment: vote.sentiment == null ? null : lookup(sentimentFromWire, vote.sentiment, 'sentiment'),
    dataClass: lookup(dataClassFromWire, vote.dataClass, 'dataClass'),
    assignedAt: vote.assignedAt ? new Date(vote.assignedAt as string) : null,
    clientSubmittedAt: vote.clientSubmittedAt ? new Date(vote.clientSubmittedAt as string) : null,
    createdAt: new Date(vote.createdAt as string),
  }));

  await prisma.$transaction(async (transaction) => {
    await transaction.rankVote.deleteMany({});
    await transaction.rankMatchup.deleteMany({});
    await transaction.rankMatchup.createMany({ data: matchups });
    await transaction.rankVote.createMany({ data: votes });
  });
  await prisma.$disconnect();

  console.log(
    `Local database reset to ${path.relative(process.cwd(), snapshotPath)}: ${matchups.length} matchups, ${votes.length} votes.`,
  );
  if (snapshot.environment && snapshot.environment !== 'local') {
    console.log('Participant and IP hashes come from the source environment\'s salt, so local hash lookups will not match them.');
  }
}

/** Takes an explicit path, or falls back to the newest snapshot in benchmark/private/votes. */
async function resolveSnapshot(args: string[]): Promise<string> {
  const explicit = args.find((arg) => !arg.startsWith('--'));
  if (explicit) return path.resolve(process.cwd(), explicit);
  const entries = (await fs.readdir(OUTPUT_DIR).catch(() => [])).filter((name) => name.endsWith('.json')).sort();
  const latest = entries.at(-1);
  if (!latest) throw new Error(`No snapshots in ${path.relative(process.cwd(), OUTPUT_DIR)}; run npm run db:export-votes first`);
  return path.join(OUTPUT_DIR, latest);
}

/** Second line of defence: even a mispointed .env cannot send this destructive import off the machine. */
function assertLoopbackDatabase(databaseUrl: string): void {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error('DATABASE_URL in .env is not a parseable connection string');
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Refusing to import: DATABASE_URL in .env points at "${host}", not a local database.`);
  }
}

function lookup<T extends Record<string, unknown>>(table: T, value: unknown, field: string): T[keyof T] {
  const mapped = table[value as string];
  if (mapped === undefined) throw new Error(`Unknown ${field} value in snapshot: ${JSON.stringify(value)}`);
  return mapped as T[keyof T];
}

try {
  await main();
} catch (error) {
  console.error(error instanceof AdminEnvironmentError || error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
