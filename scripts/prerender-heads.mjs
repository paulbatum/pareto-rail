#!/usr/bin/env node
// Prerenders a per-route <head> into a static file for each indexable static
// route, run after `vite build` in the build script. The SPA otherwise serves
// one identical head for every path — same title, description, and a canonical
// stuck at "/" — which produces duplicate-content signals and soft-404s.
//
// For each static route (from the shared `src/app/route-metadata.json`, the same
// file the React runtime reads via `src/app/seo.ts`) it copies `dist/index.html`
// to the route's static file (`/about` -> `dist/about/index.html`) with the head
// rewritten: <title>, meta description, canonical href, og:title/description/url,
// and twitter:title/description. `dist/index.html` itself is rewritten in place
// with the home entry (it should already match — this normalizes and asserts it).
//
// On Vercel, files in `dist` are served before the SPA catch-all rewrite, so
// these prerendered files are what a crawler receives for their routes. Dynamic
// routes (`/play/<id>`, `/analysis/<id>`) have no prerendered file and fall
// through to the rewrite; the runtime head sync (seo.ts) handles those.
//
// Every rewrite is anchored on an existing tag and asserts exactly one match, so
// the build fails loudly if index.html's head shape ever changes out from under
// this script rather than silently emitting stale or wrong metadata.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://paretorail.com';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const indexPath = path.join(distDir, 'index.html');
const metadataPath = path.join(root, 'src/app/route-metadata.json');

function fail(message) {
  throw new Error(message);
}

function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

// Replace exactly one tag matching `pattern` with `replacement`; fail otherwise.
// Anchoring on the tag (rather than blindly appending) keeps the head shape and
// tag order identical to index.html, and the count assertion catches drift.
function rewriteTag(html, pattern, replacement, label, route) {
  let count = 0;
  const out = html.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  if (count !== 1) fail(`Expected exactly one ${label} tag for route "${route}" but found ${count}.`);
  return out;
}

function setTitle(html, value, route) {
  return rewriteTag(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeText(value)}</title>`, '<title>', route);
}

function setMetaByName(html, name, content, route) {
  const pattern = new RegExp(`<meta name="${name}"[^>]*>`);
  return rewriteTag(html, pattern, `<meta name="${name}" content="${escapeAttr(content)}" />`, `meta[name=${name}]`, route);
}

function setMetaByProperty(html, property, content, route) {
  const pattern = new RegExp(`<meta property="${property}"[^>]*>`);
  return rewriteTag(html, pattern, `<meta property="${property}" content="${escapeAttr(content)}" />`, `meta[property=${property}]`, route);
}

function setCanonical(html, href, route) {
  return rewriteTag(html, /<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${escapeAttr(href)}" />`, 'link[rel=canonical]', route);
}

function renderHead(baseHtml, routePath, meta) {
  const url = `${SITE_ORIGIN}${meta.canonical}`;
  let html = baseHtml;
  html = setTitle(html, meta.title, routePath);
  html = setMetaByName(html, 'description', meta.description, routePath);
  html = setCanonical(html, url, routePath);
  html = setMetaByProperty(html, 'og:title', meta.title, routePath);
  html = setMetaByProperty(html, 'og:description', meta.description, routePath);
  html = setMetaByProperty(html, 'og:url', url, routePath);
  html = setMetaByName(html, 'twitter:title', meta.title, routePath);
  html = setMetaByName(html, 'twitter:description', meta.description, routePath);
  return html;
}

// Map a canonical route path to the static file that Vercel serves for it:
//   "/"            -> dist/index.html
//   "/about"       -> dist/about/index.html
//   "/levels/data" -> dist/levels/data/index.html
function outputPathFor(routePath) {
  if (routePath === '/') return indexPath;
  return path.join(distDir, ...routePath.slice(1).split('/'), 'index.html');
}

function main() {
  if (!fs.existsSync(indexPath)) {
    fail(`dist/index.html not found at ${path.relative(root, indexPath)}; run vite build before prerender-heads.`);
  }
  const baseHtml = fs.readFileSync(indexPath, 'utf8');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  const routePaths = Object.keys(metadata);
  if (routePaths.length === 0) fail('route-metadata.json defined zero routes.');

  let written = 0;
  for (const routePath of routePaths) {
    const meta = metadata[routePath];
    const html = renderHead(baseHtml, routePath, meta);
    const outputPath = outputPathFor(routePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html);
    written += 1;
  }
  console.log(`Prerendered ${written} route heads into dist/ (${routePaths.join(', ')}).`);
}

try {
  main();
} catch (error) {
  console.error(`Prerender heads failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
