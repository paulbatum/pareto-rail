import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { hashParticipant } from './rank-votes.js';
import { AdminEnvironmentError, getAdminDatabase, type AdminEnvironment } from './admin-env.js';

const ADMIN_PREFIX = '/dev/admin/api/';
const MAX_ADMIN_BODY_BYTES = 16 * 1024;

/** Mounts the vote-data admin API and page rewrite into Vite's development server only. */
export function adminApiDevPlugin(): Plugin {
  return {
    name: 'pareto-rail-admin-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0] ?? '';
        if (req.method === 'GET' && (pathname === '/dev/admin' || pathname === '/dev/admin/')) {
          req.url = '/dev/admin/index.html';
          next();
          return;
        }
        if (!pathname.startsWith(ADMIN_PREFIX)) {
          next();
          return;
        }

        const endpoint = pathname.slice(ADMIN_PREFIX.length);
        const environment = readEnvironment(req.url);
        if (!environment) {
          sendJson(res, 400, { ok: false, error: 'env must be local or prod' });
          return;
        }

        try {
          const database = getAdminDatabase(environment);
          if (endpoint === 'overview' && req.method === 'GET') {
            await sendJson(res, 200, await readOverview(database.prisma));
            return;
          }
          if (endpoint === 'votes' && req.method === 'GET') {
            await sendJson(res, 200, { ok: true, votes: await readVotes(database.prisma) });
            return;
          }
          if (endpoint === 'hash' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (!body.ok) {
              sendJson(res, body.status, { ok: false, error: body.error });
              return;
            }
            const participantId = stringField(body.value, 'participantId');
            if (!participantId) {
              sendJson(res, 400, { ok: false, error: 'participantId must be a non-empty string' });
              return;
            }
            sendJson(res, 200, { ok: true, participantHash: hashParticipant(participantId, database.participantSalt) });
            return;
          }
          if (endpoint === 'delete' && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (!body.ok) {
              sendJson(res, body.status, { ok: false, error: body.error });
              return;
            }
            const result = await deleteVotes(database.prisma, body.value);
            sendJson(res, 200, { ok: true, ...result });
            return;
          }
          if (endpoint === 'overview' || endpoint === 'votes' || endpoint === 'hash' || endpoint === 'delete') {
            sendJson(res, 405, { ok: false, error: 'Method not allowed' });
            return;
          }
          sendJson(res, 404, { ok: false, error: 'Unknown admin endpoint' });
        } catch (error) {
          if (error instanceof AdminEnvironmentError) {
            sendJson(res, 503, { ok: false, error: error.message });
            return;
          }
          if (error instanceof AdminRequestError) {
            sendJson(res, 400, { ok: false, error: error.message });
            return;
          }
          console.error('Rank admin handler failed', error instanceof Error ? error.message : 'unknown error');
          sendJson(res, 500, { ok: false, error: 'Admin database unavailable' });
        }
      });
    },
  };
}

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400; error: string };

async function readOverview(prisma: PrismaClient) {
  const [votes, matchups, participantRows, latestVote] = await Promise.all([
    prisma.rankVote.count(),
    prisma.rankMatchup.count(),
    prisma.rankVote.findMany({ select: { participantHash: true }, distinct: ['participantHash'] }),
    prisma.rankVote.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  return {
    ok: true,
    votes,
    matchups,
    participants: participantRows.length,
    latestVoteAt: latestVote?.createdAt.toISOString() ?? null,
  };
}

async function readVotes(prisma: PrismaClient) {
  const votes = await prisma.rankVote.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      participantHash: true,
      aLevelId: true,
      bLevelId: true,
      verdict: true,
      sentiment: true,
      playCountA: true,
      playCountB: true,
      bestScoreA: true,
      bestScoreB: true,
      dataClass: true,
      matchup: { select: { themeId: true } },
    },
  });
  return votes.map(({ matchup, ...vote }) => ({
    ...vote,
    createdAt: vote.createdAt.toISOString(),
    themeId: matchup.themeId,
  }));
}

async function deleteVotes(prisma: PrismaClient, value: unknown) {
  const scope = stringField(value, 'scope');
  if (scope === 'all') {
    return prisma.$transaction(async (transaction) => {
      const deletedVotes = await transaction.rankVote.deleteMany({});
      const deletedMatchups = await transaction.rankMatchup.deleteMany({});
      return { deletedVotes: deletedVotes.count, deletedMatchups: deletedMatchups.count };
    });
  }
  if (scope === 'participant') {
    const participantHash = stringField(value, 'participantHash');
    if (!participantHash) throw new AdminRequestError('participantHash must be a non-empty string');
    const deletedVotes = await prisma.rankVote.deleteMany({ where: { participantHash } });
    return { deletedVotes: deletedVotes.count, deletedMatchups: 0 };
  }
  throw new AdminRequestError('scope must be all or participant');
}

class AdminRequestError extends Error {}

async function readJsonBody(req: IncomingMessage): Promise<JsonBodyResult> {
  const body = await readBody(req);
  if (body.tooLarge) return { ok: false, status: 400, error: 'Request body too large' };
  try {
    return { ok: true, value: JSON.parse(body.value) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'Request body must be valid JSON' };
  }
}

function readBody(req: IncomingMessage): Promise<{ value: string; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > MAX_ADMIN_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve({ value: Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', reject);
  });
}

function readEnvironment(url: string | undefined): AdminEnvironment | undefined {
  let value: string | null = null;
  try {
    value = new URL(url ?? '/', 'http://localhost').searchParams.get('env');
  } catch {
    return undefined;
  }
  return value === 'local' || value === 'prod' ? value : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' && field.trim().length > 0 ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
