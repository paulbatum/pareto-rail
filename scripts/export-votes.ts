// Dumps every matchup and vote row to a timestamped JSON snapshot under benchmark/private/votes/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAdminDatabase, AdminEnvironmentError, type AdminEnvironment } from '../server/admin-env.ts';

const OUTPUT_DIR = path.resolve(process.cwd(), 'benchmark/private/votes');

// The database stores enum names; analysis tooling and the vote API speak the wire spelling.
const verdictToWire = {
  A_BETTER: 'a-better',
  B_BETTER: 'b-better',
  BOTH_GOOD: 'both-good',
  BOTH_BAD: 'both-bad',
} as const;

const relativeToWire = { A: 'a', B: 'b', TIE: 'tie' } as const;
const sentimentToWire = { POSITIVE: 'positive', NEGATIVE: 'negative' } as const;
const dataClassToWire = { ELIGIBLE: 'eligible', REHEARSAL: 'rehearsal', DEVELOPMENT: 'development' } as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const environment = readEnvironment(args);
  const exportedAt = new Date();
  const { prisma } = getAdminDatabase(environment);

  const [matchups, votes] = await Promise.all([
    prisma.rankMatchup.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.rankVote.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);

  const snapshot = {
    environment,
    exportedAt: exportedAt.toISOString(),
    counts: { matchups: matchups.length, votes: votes.length },
    matchups: matchups.map((matchup) => ({
      ...matchup,
      createdAt: matchup.createdAt.toISOString(),
    })),
    votes: votes.map((vote) => ({
      ...vote,
      verdict: verdictToWire[vote.verdict],
      relative: relativeToWire[vote.relative],
      sentiment: vote.sentiment ? sentimentToWire[vote.sentiment] : null,
      dataClass: dataClassToWire[vote.dataClass],
      assignedAt: vote.assignedAt?.toISOString() ?? null,
      clientSubmittedAt: vote.clientSubmittedAt?.toISOString() ?? null,
      createdAt: vote.createdAt.toISOString(),
    })),
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `${environment}-${fileTimestamp(exportedAt)}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await prisma.$disconnect();

  console.log(`Wrote ${matchups.length} matchups and ${votes.length} votes to ${path.relative(process.cwd(), outputPath)}`);
}

function readEnvironment(args: string[]): AdminEnvironment {
  const flag = args.find((arg) => arg.startsWith('--env='))?.slice('--env='.length) ?? args[0] ?? 'prod';
  if (flag === 'local' || flag === 'prod') return flag;
  throw new Error(`Usage: npm run db:export-votes [-- --env=prod|local] (got "${flag}")`);
}

/** ISO-8601 with the colons removed so the name is safe on every filesystem. */
function fileTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof AdminEnvironmentError || error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
