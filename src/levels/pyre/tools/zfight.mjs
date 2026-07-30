#!/usr/bin/env node
// Coplanar-face audit for pyre's authored masses.
//
// Pyre places geometry by naming where it lands in the reference frame plus how
// far away it sits, and `solveFrameBox` only ever fits width, height and lateral
// seat — it never moves a mass in z. So a mass's front face sits exactly at its
// authored depth. Two front faces both point at the camera, so wherever they
// coincide and the frame rectangles overlap, both draw and the pair fights.
//
// This parses the authored tables rather than the built scene, which keeps it
// dependency-free and fast enough to run on every edit. Run from anywhere:
//
//   node src/levels/pyre/tools/zfight.mjs
//
// Exits non-zero when a pair is too close, so it can gate a change.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Required separation as a fraction of depth. Verified empirically with
 * `npm run refcompare -- flicker` over frame pairs a small step apart: at this
 * spacing no static surface in the hero frame or along the fly-around shows
 * frame-to-frame instability.
 */
const MIN_SEPARATION = 0.008;

const here = path.dirname(fileURLToPath(import.meta.url));
const compositionPath = path.join(here, '..', 'visuals', 'composition.ts');
const source = readFileSync(compositionPath, 'utf8');

function blockAfter(marker) {
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const end = source.indexOf('\n];', from);
  return end === -1 ? null : source.slice(from, end);
}

const depths = new Map();
const depthBlock = (() => {
  const start = source.indexOf('export const PYRE_DEPTHS = {');
  if (start === -1) return '';
  return source.slice(start, source.indexOf('} as const;', start));
})();
for (const [, name, value] of depthBlock.matchAll(/(\w+):\s*([\d.]+)/g)) depths.set(name, Number(value));

function resolveDepth(expression) {
  if (/^-?[\d.]+$/.test(expression)) return Number(expression);
  const named = expression.match(/^PYRE_DEPTHS\.(\w+)(?:\s*([-+])\s*([\d.]+))?$/);
  if (!named) return null;
  const base = depths.get(named[1]);
  if (base === undefined) return null;
  if (!named[2]) return base;
  return named[2] === '+' ? base + Number(named[3]) : base - Number(named[3]);
}

const masses = [];
for (const [, group] of source.matchAll(/export const (PYRE_\w+): Slab\[\] = \[/g)) {
  const body = blockAfter(`export const ${group}: Slab[] = [`);
  if (!body) continue;
  for (const line of body.split('\n')) {
    const match = line.match(
      /x0:\s*(-?\d+),\s*y0:\s*(-?\d+),\s*x1:\s*(-?\d+),\s*y1:\s*(-?\d+)\s*\},\s*depth:\s*([^,]+),/,
    );
    if (!match) continue;
    const depth = resolveDepth(match[5].trim());
    if (depth === null) {
      console.error(`Unresolved depth expression in ${group}: ${match[5].trim()}`);
      process.exit(2);
    }
    masses.push({
      group,
      depth,
      rect: [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])],
    });
  }
}

if (masses.length === 0) {
  console.error(`No masses parsed from ${compositionPath}`);
  process.exit(2);
}

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const sharedArea = (a, b) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

const offenders = [];
for (let i = 0; i < masses.length; i += 1) {
  for (let j = i + 1; j < masses.length; j += 1) {
    const a = masses[i];
    const b = masses[j];
    if (!overlaps(a.rect, b.rect)) continue;
    const gap = Math.abs(a.depth - b.depth);
    const needed = Math.max(a.depth, b.depth) * MIN_SEPARATION;
    if (gap >= needed) continue;
    offenders.push({ a, b, gap, needed, area: sharedArea(a.rect, b.rect) });
  }
}

console.log(
  `pyre z-fight audit: ${masses.length} authored masses, minimum separation ${MIN_SEPARATION * 100}% of depth`,
);
if (offenders.length === 0) {
  console.log('no overlapping pair shares a plane');
  process.exit(0);
}

for (const { a, b, gap, needed, area } of offenders.sort((x, y) => y.area - x.area)) {
  console.log(
    `${gap === 0 ? 'COPLANAR ' : 'TOO CLOSE'} gap=${gap.toFixed(2)} needs=${needed.toFixed(2)}  ` +
      `${a.group}@${a.depth} x ${b.group}@${b.depth}  shared=${Math.round(area)}px2`,
  );
}
console.log(`\n${offenders.length} fighting pair(s) — separate them in depth, or bury one face deep inside the other mass`);
process.exit(1);
