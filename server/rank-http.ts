import type { PrismaClient } from '../src/generated/prisma/client';
import { MAX_RANK_VOTE_BODY_BYTES, validateRankVoteBody } from './rank-vote-validation';
import { readRankStats, recordRankVote } from './rank-votes';

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

export async function handleRankVotesRequest(request: Request, prisma: PrismaClient, ip: string): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!allowRequest(ip)) return json({ ok: false, error: 'Too many requests' }, 429);
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return json({ ok: false, error: 'Content-Type must be application/json' }, 400);
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_RANK_VOTE_BODY_BYTES) {
    return json({ ok: false, error: 'Request body too large' }, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return json({ ok: false, error: 'Request body must be valid JSON' }, 400);
  }

  const validation = validateRankVoteBody(parsed);
  if (!validation.ok) return json({ ok: false, error: validation.error }, validation.status);

  try {
    const result = await recordRankVote(validation.value, prisma);
    return json(result.body, result.status);
  } catch (error) {
    console.error('Rank vote persistence failed', error instanceof Error ? error.message : 'unknown error');
    return json({ ok: false, error: 'Vote storage unavailable' }, 500);
  }
}

export async function handleRankStatsRequest(request: Request, prisma: PrismaClient): Promise<Response> {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  try {
    const result = await readRankStats(prisma);
    return json(result.body, result.status);
  } catch (error) {
    console.error('Rank stats persistence failed', error instanceof Error ? error.message : 'unknown error');
    return json({ ok: false, error: 'Stats unavailable' }, 500);
  }
}

/** Best-effort per-IP limiting: serverless instances do not share this map. */
function allowRequest(ip: string): boolean {
  const now = Date.now();
  const prior = rateBuckets.get(ip);
  if (!prior || now - prior.startedAt >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (prior.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  prior.count += 1;
  return true;
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
