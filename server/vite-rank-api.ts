import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { getPrismaClient } from './prisma.js';
import { handleRankStatsRequest, handleRankVotesRequest } from './rank-http.js';
import { MAX_RANK_VOTE_BODY_BYTES } from './rank-vote-validation.js';

/** Mounts the production handlers into Vite's development server only. */
export function rankApiDevPlugin(): Plugin {
  return {
    name: 'raild-rank-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        const isVotes = url === '/api/rank/votes';
        const isStats = url === '/api/rank/stats';
        if (!isVotes && !isStats) {
          next();
          return;
        }

        try {
          if (isVotes && req.method === 'POST') {
            const body = await readBody(req);
            if (body.tooLarge) {
              sendJson(res, 400, { ok: false, error: 'Request body too large' });
              return;
            }
            const response = await handleRankVotesRequest(
              makeRequest(req, body.value),
              getPrismaClient(),
              req.socket?.remoteAddress ?? 'unknown',
            );
            await sendResponse(res, response);
            return;
          }

          const response = await handleRankStatsRequest(makeRequest(req), getPrismaClient());
          await sendResponse(res, response);
        } catch (error) {
          console.error('Rank development handler failed', error instanceof Error ? error.message : 'unknown error');
          sendJson(res, 500, { ok: false, error: 'Rank service unavailable' });
        }
      });
    },
  };
}

function makeRequest(req: IncomingMessage, body?: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
    method: req.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function readBody(req: IncomingMessage): Promise<{ value: string; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > MAX_RANK_VOTE_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve({ value: Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', reject);
  });
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

