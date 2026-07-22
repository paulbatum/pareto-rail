import { next } from '@vercel/edge';

// Vercel Edge Middleware: gives shared `/match?a=<id>&b=<id>` links a dynamic
// social card. Social crawlers don't run JS, so without this they'd receive the
// SPA's static index.html with the generic default og:image. For a well-formed
// match link, this fetches the deployment's index.html and rewrites the head so
// og:image/twitter:image point at the composite `/api/og/match` card and the
// unfurl text matches what the client-side head sync (src/app/seo.ts) produces.
//
// It runs before the SPA rewrite in vercel.json. The matcher scopes it to /match
// only, so every other route is untouched; /match without valid a/b params (and
// any failure) falls through to the normal SPA response via next().

export const config = { matcher: '/match' };

const SITE_ORIGIN = 'https://paretorail.com';
const SLUG = /^[a-z0-9-]{1,64}$/;

// The match route's generic metadata. Duplicated from `src/app/seo.ts`
// (`metaForRoute` match branch + FALLBACK_DESCRIPTION) so the crawler's unfurl
// text matches the client-side head sync. Keep in sync if seo.ts changes.
const MATCH_TITLE = 'Pareto Rail — Custom match';
const MATCH_DESCRIPTION =
  'Play two Pareto Rail levels head-to-head and vote which felt better. ' +
  'Play 60-second rail-shooter levels built by AI models, rank them blind, and compare level quality against generation cost.';

// Card geometry — mirrors WIDTH/HEIGHT in api/og/match.tsx.
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Replace exactly one tag matching `pattern`; throw on any other count so a
// changed head shape falls through to the untouched page rather than emitting
// half-rewritten metadata.
function rewriteOne(html: string, pattern: RegExp, replacement: string, label: string): string {
  let count = 0;
  const out = html.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  if (count !== 1) throw new Error(`Expected exactly one ${label} tag but found ${count}.`);
  return out;
}

function rewriteHead(html: string, cardUrl: string, matchUrl: string): string {
  let out = html;
  out = rewriteOne(out, /<title>[\s\S]*?<\/title>/, `<title>${escapeText(MATCH_TITLE)}</title>`, '<title>');
  out = rewriteOne(
    out,
    /<meta name="description"[^>]*>/,
    `<meta name="description" content="${escapeAttr(MATCH_DESCRIPTION)}" />`,
    'meta[name=description]',
  );
  out = rewriteOne(out, /<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escapeAttr(matchUrl)}" />`, 'link[rel=canonical]');
  const metaProperty = (property: string, content: string) =>
    rewriteOne(
      out,
      new RegExp(`<meta property="${property}"[^>]*>`),
      `<meta property="${property}" content="${escapeAttr(content)}" />`,
      `meta[property=${property}]`,
    );
  const metaName = (name: string, content: string) =>
    rewriteOne(
      out,
      new RegExp(`<meta name="${name}"[^>]*>`),
      `<meta name="${name}" content="${escapeAttr(content)}" />`,
      `meta[name=${name}]`,
    );
  out = metaProperty('og:title', MATCH_TITLE);
  out = metaProperty('og:description', MATCH_DESCRIPTION);
  out = metaProperty('og:url', matchUrl);
  out = metaProperty('og:image', cardUrl);
  out = metaProperty('og:image:width', String(CARD_WIDTH));
  out = metaProperty('og:image:height', String(CARD_HEIGHT));
  out = metaName('twitter:title', MATCH_TITLE);
  out = metaName('twitter:description', MATCH_DESCRIPTION);
  out = metaName('twitter:image', cardUrl);
  return out;
}

export default async function middleware(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const a = url.searchParams.get('a') ?? '';
    const b = url.searchParams.get('b') ?? '';
    if (!SLUG.test(a) || !SLUG.test(b)) return next();

    const indexRes = await fetch(new URL('/index.html', url.origin));
    if (!indexRes.ok) return next();
    const html = await indexRes.text();

    const cardUrl = `${SITE_ORIGIN}/api/og/match?a=${a}&b=${b}`;
    const matchUrl = `${SITE_ORIGIN}/match`;
    const rewritten = rewriteHead(html, cardUrl, matchUrl);

    return new Response(rewritten, {
      status: 200,
      headers: { 'Content-Type': indexRes.headers.get('content-type') ?? 'text/html; charset=utf-8' },
    });
  } catch {
    // Never break the page: fall through to the normal SPA response.
    return next();
  }
}
