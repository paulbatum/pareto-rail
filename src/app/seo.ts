// Single source of truth for per-route SEO head metadata.
//
// The static-route entries live in `route-metadata.json` so a plain-node build
// script (`scripts/prerender-heads.mjs`) can read the exact same titles and
// descriptions this module serves at runtime — the prerendered head a crawler
// sees and the head client-side navigation produces can never drift.
//
// This module adds the runtime-only pieces: absolute-URL construction, metadata
// for the dynamic routes (`/play/<id>`, `/analysis/<id>`) and the 404 view, and
// `applyRouteHead`, which syncs the live document head on every route change.
import routeMetadata from './route-metadata.json';
import { routePath, type AppRoute } from './router';

/** The one canonical origin. Mirrors the host redirect in `vercel.json`. */
export const SITE_ORIGIN = 'https://paretorail.com';

export interface RouteMeta {
  /** `<title>` and og/twitter title. */
  title: string;
  /** Meta description and og/twitter description. */
  description: string;
  /** Canonical path (leading slash); resolved to an absolute URL for the head. */
  canonical: string;
}

const STATIC_META: Record<string, RouteMeta> = routeMetadata;

const FALLBACK_DESCRIPTION =
  'Play 60-second rail-shooter levels built by AI models, rank them blind, and compare level quality against generation cost.';

/** Resolve a canonical path (e.g. `/about`) to an absolute URL on the one origin. */
export function absoluteUrl(canonicalPath: string): string {
  return `${SITE_ORIGIN}${canonicalPath}`;
}

/**
 * SEO metadata for any route. Static routes come straight from the shared JSON
 * (keyed by their canonical path); the dynamic routes and the 404 view get a
 * sensible title/description derived from the route so the head stays coherent.
 */
export function metaForRoute(route: AppRoute): RouteMeta {
  const path = routePath(route);
  const staticMeta = STATIC_META[path];
  if (staticMeta) return staticMeta;

  if (route.kind === 'play') {
    return {
      title: `Pareto Rail — Play ${route.levelId}`,
      description: `Play ${route.levelId}, a rail-shooter level in the Pareto Rail benchmark. ${FALLBACK_DESCRIPTION}`,
      canonical: path,
    };
  }
  if (route.kind === 'analysis') {
    return {
      title: `Pareto Rail — Analysis: ${route.levelId}`,
      description: `Rollout analysis for ${route.levelId}: the narrative, timeline, file edits, and reconstructed snapshots behind this model-built level.`,
      canonical: path,
    };
  }
  if (route.kind === 'notFound') {
    return { title: 'Pareto Rail — Not found', description: FALLBACK_DESCRIPTION, canonical: path };
  }
  // Every AppRoute kind is covered above or by STATIC_META; keep a safe default.
  return { title: 'Pareto Rail', description: FALLBACK_DESCRIPTION, canonical: path };
}

/**
 * Sync the live document head to `route`. Called on every route change so that
 * client-side navigation keeps title, description, canonical, and og/twitter
 * tags consistent with the prerendered file the same route would have served.
 * The 404 view additionally gets a `robots: noindex` tag so soft-404s (served
 * 200 by the SPA rewrite) don't get indexed; it is removed on any other route.
 */
export function applyRouteHead(route: AppRoute): void {
  const meta = metaForRoute(route);
  const url = absoluteUrl(meta.canonical);

  document.title = meta.title;
  setMetaByName('description', meta.description);
  setLinkHref('canonical', url);
  setMetaByProperty('og:url', url);
  setMetaByProperty('og:title', meta.title);
  setMetaByProperty('og:description', meta.description);
  setMetaByName('twitter:title', meta.title);
  setMetaByName('twitter:description', meta.description);
  setNoindex(route.kind === 'notFound');
}

function setMetaByName(name: string, content: string): void {
  upsertMeta('name', name).setAttribute('content', content);
}

function setMetaByProperty(property: string, content: string): void {
  upsertMeta('property', property).setAttribute('content', content);
}

function upsertMeta(attr: 'name' | 'property', key: string): HTMLMetaElement {
  const selector = `meta[${attr}="${key}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attr, key);
    document.head.appendChild(element);
  }
  return element;
}

function setLinkHref(rel: string, href: string): void {
  const selector = `link[rel="${rel}"]`;
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

function setNoindex(noindex: boolean): void {
  const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (noindex) {
    if (existing) existing.setAttribute('content', 'noindex');
    else setMetaByName('robots', 'noindex');
  } else if (existing) {
    existing.remove();
  }
}
