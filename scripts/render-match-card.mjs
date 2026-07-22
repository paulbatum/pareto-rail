#!/usr/bin/env node
// Renders the /api/og/match social card locally so card work doesn't need a
// deploy: transpiles the edge function with the repo's TypeScript, stubs fetch
// to serve the hero JPEGs from dist/, and writes the PNG to tmp/match-card.png.
//
//   node scripts/render-match-card.mjs [<id-a> <id-b>]
//
// Ids default to the first two heroes found in dist/social/heroes. Run
// `node scripts/generate-social-heroes.mjs` (after a vite build) first to
// populate that directory. The function has no relative imports, so a single
// transpiled file suffices; its package imports (@vercel/og, react) resolve
// from node_modules, and @vercel/og loads its font/wasm from its own dist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const heroesDir = path.join(root, 'dist/social/heroes');
const tmpDir = path.join(root, 'tmp');
const modulePath = path.join(tmpDir, 'og-match-render.mjs');
const outputPath = path.join(tmpDir, 'match-card.png');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(heroesDir)) {
  fail('dist/social/heroes not found; run `node scripts/generate-social-heroes.mjs` (after a vite build) first.');
}

const available = fs.readdirSync(heroesDir).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).sort();
const [a = available[0], b = available[1]] = process.argv.slice(2);
if (!a || !b) fail('Need two level ids (or at least two heroes in dist/social/heroes).');
for (const id of [a, b]) {
  if (!fs.existsSync(path.join(heroesDir, `${id}.jpg`))) fail(`No hero JPEG for "${id}" in dist/social/heroes.`);
}

const source = fs.readFileSync(path.join(root, 'api/og/match.tsx'), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(modulePath, transpiled);

// Serve hero requests from dist; anything else falls through to real fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof URL ? input.href : input);
  const match = url.match(/\/social\/heroes\/([a-z0-9-]+)\.jpg$/);
  if (match) {
    const heroPath = path.join(heroesDir, `${match[1]}.jpg`);
    if (!fs.existsSync(heroPath)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(heroPath), { status: 200 });
  }
  return realFetch(input, init);
};

const { GET } = await import(modulePath);
const res = await GET(new Request(`https://paretorail.com/api/og/match?a=${a}&b=${b}`));
fs.rmSync(modulePath);
if (res.status !== 200) fail(`Card render returned ${res.status} (redirects mean an id fell back to the default card).`);
fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
console.log(`Rendered ${a} vs ${b} -> ${path.relative(root, outputPath)}`);
