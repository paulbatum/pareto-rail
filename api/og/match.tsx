import type { ReactElement } from 'react';
import { ImageResponse } from '@vercel/og';
import { catalogLevelIds, rankCatalog } from '../../src/benchmark/catalog.js';
import { drawCandidateLevelIds } from '../../src/app/model-match.js';

// Dynamic social card for a shared `/match` link, in the two shapes the
// middleware cards. `/match` is a blind comparison, so the card carries no level
// titles or model names — images only.
//
// `?a=<id>&b=<id>` names both levels, so the card composites their two hero
// screenshots side by side with a "VS" badge: it shows the match itself.
//
// `?model=<slug>` (with an optional `&vs=<slug>`) leaves the pair to a draw made
// when the link is opened, so there is no pair to show. The card instead tiles
// four heroes from the levels the draw can reach, spread across themes, which
// previews what is in play without promising any particular matchup. A pool of
// exactly two levels admits only one matchup, so that one gets the VS composite.
//
// Hero sources are the build-time JPEGs at `/social/heroes/<id>.jpg` (see
// `scripts/generate-social-heroes.mjs`); satori cannot decode the committed AVIF
// heroes. Fetching them from the request origin doubles as the id-existence check:
// a non-200 means an unknown id, and the card falls back to the default social
// card rather than erroring. Text uses @vercel/og's bundled fallback font.

// This function runs on the Node runtime, not the edge one. `catalog.ts` reads
// the catalog with a JSON import attribute (`with { type: 'json' }`), which the
// Node runtime accepts and Vercel's edge bundler rejects with
// `Expected ";" but found "with"` at deploy time.
export const config = { runtime: 'nodejs' };

const SLUG = /^[a-z0-9-]{1,64}$/;

// Card geometry — mirrored in the middleware's og:image:width/height rewrite.
const WIDTH = 1200;
const HEIGHT = 630;
/** Panes in the draw card's grid. */
const PANES = 4;

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

/** One cell of the four-up grid. An absent hero leaves the mark on the
 * background, which is what a pool of three levels gets in its fourth cell. */
function gridCell(src: string | undefined): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: WIDTH / 2, height: HEIGHT / 2, overflow: 'hidden', background: BG }}>
      {src
        ? <img src={src} width={WIDTH / 2} height={HEIGHT / 2} style={{ objectFit: 'cover' }} />
        : <img src={markDataUri()} width={64} height={64} />}
    </div>
  );
}

function divider(style: Record<string, number | string>): ReactElement {
  return <div style={{ position: 'absolute', background: BG, ...style }} />;
}

/** The brand lockup, on a dark bar so it stays readable over bright heroes. */
function brandLockup(): ReactElement {
  return (
    <div style={{ position: 'absolute', left: 34, bottom: 30, display: 'flex', alignItems: 'center', padding: '12px 20px', background: BG }}>
      <img src={markDataUri()} width={36} height={36} />
      <div style={{ display: 'flex', marginLeft: 14, fontSize: 24, fontWeight: 600, letterSpacing: 6, color: CREAM }}>
        PARETO RAIL
      </div>
    </div>
  );
}

/** Says what the four panes are, so the card is not read as a four-level match. */
function drawCaption(): ReactElement {
  return (
    <div style={{ position: 'absolute', right: 34, bottom: 30, display: 'flex', padding: '14px 20px', background: BG }}>
      <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, letterSpacing: 3, color: CREAM }}>
        PAIR DRAWN WHEN YOU OPEN IT
      </div>
    </div>
  );
}

function cardResponse(element: ReactElement): Response {
  return new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    headers: {
      // Crawlers and the CDN cache the composite; content is deterministic for a
      // given pair of level ids and for a given pair of model slugs alike.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}

/** The card for a link that names both levels: the match itself. */
async function pairCard(origin: string, a: string, b: string): Promise<Response> {
  const [heroA, heroB] = await Promise.all([fetchHeroDataUri(origin, a), fetchHeroDataUri(origin, b)]);
  if (!heroA || !heroB) return defaultCard(origin);
  return cardResponse(
    <div style={{ display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT, background: BG }}>
      {heroHalf(heroA)}
      {heroHalf(heroB)}
      {divider({ left: WIDTH / 2 - 1, top: 0, width: 2, height: HEIGHT })}

      {/* VS badge: a rotated-square diamond echoing the mark, with upright "VS". */}
      <div style={{ position: 'absolute', left: WIDTH / 2 - 70, top: HEIGHT / 2 - 70, width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', left: 20, top: 20, width: 100, height: 100, background: BG, border: `3px solid ${CREAM}`, transform: 'rotate(45deg)' }} />
        <div style={{ display: 'flex', fontSize: 46, fontWeight: 700, letterSpacing: 2, color: CREAM }}>VS</div>
      </div>

      {brandLockup()}
    </div>,
  );
}

/**
 * The card for a link that names models and leaves the pair to a draw: four
 * heroes from the levels the draw can reach. More ids are fetched than are shown
 * so a level whose hero is missing costs a pane rather than the card. Two
 * candidates means one possible matchup, which the pair card shows outright.
 */
async function drawCard(origin: string, model: string, opponent: string | null): Promise<Response> {
  const candidates = drawCandidateLevelIds(model, {
    playable: catalogLevelIds(rankCatalog),
    ...(opponent === null ? {} : { opponent }),
  });
  if (candidates.length === 0) return defaultCard(origin);
  if (candidates.length === 2) return pairCard(origin, candidates[0]!, candidates[1]!);

  const fetched = await Promise.all(candidates.slice(0, PANES + 2).map((id) => fetchHeroDataUri(origin, id)));
  const heroes = fetched.filter((hero): hero is string => hero !== null).slice(0, PANES);
  if (heroes.length < 2) return defaultCard(origin);

  return cardResponse(
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', width: WIDTH, height: HEIGHT, background: BG }}>
      <div style={{ display: 'flex' }}>{gridCell(heroes[0])}{gridCell(heroes[1])}</div>
      <div style={{ display: 'flex' }}>{gridCell(heroes[2])}{gridCell(heroes[3])}</div>
      {divider({ left: WIDTH / 2 - 1, top: 0, width: 2, height: HEIGHT })}
      {divider({ left: 0, top: HEIGHT / 2 - 1, width: WIDTH, height: 2 })}
      {brandLockup()}
      {drawCaption()}
    </div>,
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = url.origin;

    const a = url.searchParams.get('a') ?? '';
    const b = url.searchParams.get('b') ?? '';
    if (SLUG.test(a) && SLUG.test(b)) return await pairCard(origin, a, b);

    // Mirrors the middleware's `cardQuery`: a present-but-malformed `vs` names no
    // model, and gets the default card rather than a one-model draw.
    const model = url.searchParams.get('model') ?? '';
    const versus = url.searchParams.get('vs');
    if (SLUG.test(model) && (versus === null || SLUG.test(versus))) return await drawCard(origin, model, versus);

    return defaultCard(origin);
  } catch (error) {
    console.error('Match OG card failed', error instanceof Error ? error.message : 'unknown error');
    try {
      return defaultCard(new URL(request.url).origin);
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
}
