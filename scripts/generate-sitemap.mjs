#!/usr/bin/env node
// Emits dist/sitemap.xml for search engines. Runs after `vite build` in the
// build script. Dependency-free by design: it reads the same source-of-truth
// data files the app does, so the sitemap can never drift from a hardcoded list.
//
// URL inventory:
//   - static routes: /, /levels, /levels/data, /rank, /leaderboard, /about, /analysis
//   - /play/<id> for every playable level:
//       * built-in registry ids (src/levels/index.ts), excluding `technical`
//         levels, which the in-game gallery also hides (selectableLevels)
//       * rank-catalog entrant ids (src/benchmark/rank-catalog.json), excluding
//         `retired` entrants whose level module has been deleted and so no
//         longer render at /play/<id>. Test fixtures never enter the catalog.
//   - /analysis/<id> for each analysis package directory under benchmark/analysis/
//
// Fails the build loudly if it cannot enumerate the built-in registry or the
// rank catalog — a silently empty sitemap would be worse than a broken build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://paretorail.com';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const outputPath = path.join(distDir, 'sitemap.xml');

const STATIC_ROUTES = ['/', '/levels', '/levels/data', '/rank', '/leaderboard', '/about', '/analysis'];

function fail(message) {
  throw new Error(message);
}

// The built-in registry is a TypeScript literal, so we cannot import it from a
// plain node script without a loader. Parse the `levelMetadatas` array for each
// entry's id and kind; every entry declares its id before its kind.
function builtInPlayableIds() {
  const source = fs.readFileSync(path.join(root, 'src/levels/index.ts'), 'utf8');
  const match = source.match(/export const levelMetadatas[^=]*=\s*\[([\s\S]*?)\];/);
  if (!match) fail('Could not locate levelMetadatas array in src/levels/index.ts.');
  const body = match[1];
  const ids = [];
  const entryPattern = /id:\s*'([^']+)'[\s\S]*?kind:\s*'([^']+)'/g;
  let entry;
  while ((entry = entryPattern.exec(body)) !== null) {
    const [, id, kind] = entry;
    if (kind !== 'technical') ids.push(id);
  }
  if (ids.length === 0) fail('Parsed zero playable built-in levels from src/levels/index.ts.');
  return ids;
}

function rankCatalogPlayableIds() {
  const catalogPath = path.join(root, 'src/benchmark/rank-catalog.json');
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (error) {
    fail(`Could not read rank catalog ${path.relative(root, catalogPath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(catalog.entrants)) fail('Rank catalog has no entrants array.');
  const ids = new Set();
  for (const entrant of catalog.entrants) {
    // A retired entrant whose level module was deleted no longer renders at
    // /play/<id>; one still promoted keeps its thumbnail and stays playable.
    if (entrant.retired && !entrant.thumbnailPath) continue;
    if (typeof entrant.levelId === 'string' && entrant.levelId) ids.add(entrant.levelId);
  }
  if (ids.size === 0) fail('Rank catalog produced zero playable entrant ids.');
  return [...ids];
}

function analysisIds() {
  const analysisRoot = path.join(root, 'benchmark/analysis');
  if (!fs.existsSync(analysisRoot)) return [];
  return fs
    .readdirSync(analysisRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function xmlEscape(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc) {
  return `  <url>\n    <loc>${xmlEscape(BASE_URL + loc)}</loc>\n  </url>`;
}

function main() {
  const playIds = [
    ...builtInPlayableIds(),
    ...rankCatalogPlayableIds(),
  ];
  // Level ids are lowercase [a-z0-9-] (docs/compat.md), so path segments need no
  // percent-encoding; dedupe defensively in case an id appears in both sources.
  const playPaths = [...new Set(playIds)].sort().map((id) => `/play/${id}`);
  const analysisPaths = analysisIds().sort().map((id) => `/analysis/${id}`);

  const paths = [...STATIC_ROUTES, ...playPaths, ...analysisPaths];

  if (!fs.existsSync(distDir)) {
    fail(`dist directory not found at ${path.relative(root, distDir)}; run vite build before generate-sitemap.`);
  }

  const body = paths.map(urlEntry).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  fs.writeFileSync(outputPath, xml);
  console.log(`Wrote ${path.relative(root, outputPath)} with ${paths.length} URLs (${playPaths.length} play, ${analysisPaths.length} analysis).`);
}

try {
  main();
} catch (error) {
  console.error(`Sitemap generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
