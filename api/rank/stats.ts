import { handleRankStatsRequest } from '../../server/rank-http.js';
import { getPrismaClient } from '../../server/prisma.js';

export async function GET(request: Request): Promise<Response> {
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
