#!/usr/bin/env node
// Renders the home-screen icon set from the wordmark's diamond mark into
// `public/icons/`, which is gitignored: the repo forbids tracked PNG files, and
// "add to home screen" needs PNG (Safari ignores SVG for apple-touch-icon, and
// Android maskable icons must be raster). Runs before both `dev` and `build` so
// the icons exist wherever the manifest is served from.
//
// Two framings of the same mark: the plain icon fills more of the tile because
// iOS and Android only round the corners, while the maskable one is pulled in to
// survive a circle crop (the safe zone is the inner 80% of the canvas).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/icons');

const BACKGROUND = '#171410';
const STROKE = '#F2EDDF';
const ACCENT = '#E85D93';

// `mark` is the fraction of the tile's width the mark spans, corner to corner.
function iconSvg(size, mark) {
  // The source mark is drawn in a 22-unit box and nearly fills it, so scaling
  // that box to `size * mark` gives the mark roughly that share of the tile.
  const scale = (size * mark) / 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BACKGROUND}"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(-11 -11)">
    <rect x="4.5" y="4.5" width="13" height="13" transform="rotate(45 11 11)" fill="none" stroke="${STROKE}" stroke-width="1.4"/>
    <circle cx="11" cy="11" r="3" fill="${ACCENT}"/>
  </g>
</svg>`;
}

const targets = [
  { file: 'icon-192.png', size: 192, mark: 0.72 },
  { file: 'icon-512.png', size: 512, mark: 0.72 },
  { file: 'maskable-512.png', size: 512, mark: 0.52 },
  { file: 'apple-touch-icon.png', size: 180, mark: 0.68 },
];

fs.mkdirSync(outDir, { recursive: true });

await Promise.all(targets.map(async ({ file, size, mark }) => {
  await sharp(Buffer.from(iconSvg(size, mark))).png({ compressionLevel: 9 }).toFile(path.join(outDir, file));
}));

console.log(`Generated ${targets.length} home-screen icons in public/icons.`);
