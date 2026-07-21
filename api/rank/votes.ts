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

/**
 * The client IP as seen by Vercel's edge. `x-real-ip` is set by the platform and
 * is not client-spoofable; the rightmost `x-forwarded-for` entry (appended by the
 * trusted proxy) is the fallback. Never trust the leftmost XFF entry — the client
 * controls it.
 */
function requestIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}
