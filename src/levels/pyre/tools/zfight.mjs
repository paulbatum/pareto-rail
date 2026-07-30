#!/usr/bin/env node
// Coplanar-face audit for pyre's authored masses.
//
// Pyre places geometry by naming where it lands in the reference frame plus how
// far away it sits, and `solveFrameBox` only ever fits width, height and lateral
// seat — it never moves a mass in z. So a mass's front face sits exactly at its
// authored depth. Two front faces both point at the camera, so wherever they
// coincide and the frame rectangles overlap, both draw and the pair fights.
//
//   node src/levels/pyre/tools/zfight.mjs
//
// Exits non-zero when a pair is too close, so it can gate a change.

import { readMasses } from './read-masses.mjs';

/**
 * Required separation as a fraction of depth. Verified empirically with
 * `npm run refcompare -- flicker` over frame pairs a small step apart: at this
 * spacing no static surface in the hero frame or along the fly-around shows
 * frame-to-frame instability.
 */
const MIN_SEPARATION = 0.008;

const masses = readMasses().map((mass) => ({
  group: mass.group,
  depth: mass.depth,
  rect: [mass.rect.x0, mass.rect.y0, mass.rect.x1, mass.rect.y1],
}));

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
