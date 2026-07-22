import type { ReactElement } from 'react';
import { ImageResponse } from '@vercel/og';

// Dynamic social card for a custom `/match?a=<id>&b=<id>` share link. Composites
// the two levels' hero screenshots side by side with a "VS" badge and the Pareto
// Rail mark into a 1200x630 image crawlers can unfurl. `/match` is a blind
// comparison, so the card carries no level titles or model names — images only.
//
// Hero sources are the build-time JPEGs at `/social/heroes/<id>.jpg` (see
// `scripts/generate-social-heroes.mjs`); satori cannot decode the committed AVIF
// heroes. Fetching them from the request origin doubles as the id-existence check:
// a non-200 means an unknown id, and the card falls back to the default social
// card rather than erroring. Text uses @vercel/og's bundled fallback font.

export const config = { runtime: 'edge' };

const SLUG = /^[a-z0-9-]{1,64}$/;

// Card geometry — mirrored in the middleware's og:image:width/height rewrite.
const WIDTH = 1200;
const HEIGHT = 630;

// Site palette (index.html / public/icon.svg).
const BG = '#171410';
const CREAM = '#F2EDDF';
const PINK = '#E85D93';

// The site mark: rotated square outline + pink dot, on a transparent field.
const MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">` +
  `<rect x="4.5" y="4.5" width="13" height="13" transform="rotate(45 11 11)" fill="none" stroke="${CREAM}" stroke-width="1.4"/>` +
  `<circle cx="11" cy="11" r="3" fill="${PINK}"/>` +
  `</svg>`;

function markDataUri(): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(MARK_SVG)}`;
}

function defaultCard(origin: string): Response {
  // Unknown id or a failed hero fetch: hand crawlers the generic card instead of
  // an error, so the link still unfurls.
  return Response.redirect(`${origin}/social/card.jpg`, 302);
}

async function fetchHeroDataUri(origin: string, id: string): Promise<string | null> {
  const res = await fetch(`${origin}/social/heroes/${id}.jpg`);
  if (!res.ok) return null;
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function heroHalf(src: string): ReactElement {
  return (
    <div style={{ display: 'flex', width: WIDTH / 2, height: HEIGHT, overflow: 'hidden' }}>
      <img src={src} width={WIDTH / 2} height={HEIGHT} style={{ objectFit: 'cover' }} />
    </div>
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = url.origin;
    const a = url.searchParams.get('a') ?? '';
    const b = url.searchParams.get('b') ?? '';

    if (!SLUG.test(a) || !SLUG.test(b)) return defaultCard(origin);

    const [heroA, heroB] = await Promise.all([
      fetchHeroDataUri(origin, a),
      fetchHeroDataUri(origin, b),
    ]);
    if (!heroA || !heroB) return defaultCard(origin);

    const element = (
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: WIDTH,
          height: HEIGHT,
          background: BG,
        }}
      >
        {heroHalf(heroA)}
        {heroHalf(heroB)}

        {/* Center divider */}
        <div
          style={{
            position: 'absolute',
            left: WIDTH / 2 - 1,
            top: 0,
            width: 2,
            height: HEIGHT,
            background: BG,
          }}
        />

        {/* VS badge: a rotated-square diamond echoing the mark, with upright "VS". */}
        <div
          style={{
            position: 'absolute',
            left: WIDTH / 2 - 70,
            top: HEIGHT / 2 - 70,
            width: 140,
            height: 140,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 20,
              top: 20,
              width: 100,
              height: 100,
              background: BG,
              border: `3px solid ${CREAM}`,
              transform: 'rotate(45deg)',
            }}
          />
          <div
            style={{
              display: 'flex',
              fontSize: 46,
              fontWeight: 700,
              letterSpacing: 2,
              color: CREAM,
            }}
          >
            VS
          </div>
        </div>

        {/* Brand lockup: mark + wordmark, bottom-left, on a dark bar so it
            stays readable over bright heroes. */}
        <div
          style={{
            position: 'absolute',
            left: 34,
            bottom: 30,
            display: 'flex',
            alignItems: 'center',
            padding: '12px 20px',
            background: BG,
          }}
        >
          <img src={markDataUri()} width={36} height={36} />
          <div
            style={{
              display: 'flex',
              marginLeft: 14,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: 6,
              color: CREAM,
            }}
          >
            PARETO RAIL
          </div>
        </div>
      </div>
    );

    return new ImageResponse(element, {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        // Crawlers and the CDN cache the composite; content is deterministic per id pair.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('Match OG card failed', error instanceof Error ? error.message : 'unknown error');
    try {
      return defaultCard(new URL(request.url).origin);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
}
