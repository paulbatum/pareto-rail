import { handleRankStatsRequest } from '../../server/rank-http';
import { getPrismaClient } from '../../server/prisma';

export const runtime = 'nodejs';

export default async function handler(request: Request): Promise<Response> {
  try {
    return await handleRankStatsRequest(request, getPrismaClient());
  } catch (error) {
    console.error('Rank stats handler failed', error instanceof Error ? error.message : 'unknown error');
    return new Response(JSON.stringify({ ok: false, error: 'Stats service unavailable' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
