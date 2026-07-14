import { handleRankVotesRequest } from '../../server/rank-http.js';
import { getPrismaClient } from '../../server/prisma.js';

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleRankVotesRequest(request, getPrismaClient(), requestIp(request));
  } catch (error) {
    console.error('Rank vote handler failed', error instanceof Error ? error.message : 'unknown error');
    return new Response(JSON.stringify({ ok: false, error: 'Vote service unavailable' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

function requestIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
}
