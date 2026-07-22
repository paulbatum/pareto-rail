#!/usr/bin/env node
// Renders the site-wide social card (`public/social/card.jpg`) — the image
// crawlers unfurl for the homepage and any page without its own card.
//
//   node scripts/render-site-card.mjs <id-a> <id-b> [--out <path>]
//
// The layout mirrors the dynamic match card (`api/og/match.tsx`): two level
// heroes side by side under a VS diamond. Unlike that card, this one is static
// and not blind, so it carries a caption bar naming what the site is.
//
// Hero sources are the committed AVIFs at `public/level-content/<id>/hero.avif`,
// rasterized here with sharp because satori cannot decode AVIF. Swapping the
// card to a different pair of levels is a matter of re-running this with two
// other ids; the result is committed, so nothing is generated at build time.
//
// The card is built with React.createElement rather than JSX so this stays a
// single plain .mjs file node can run directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { ImageResponse } from '@vercel/og';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'public/level-content');
const defaultOut = path.join(root, 'public/social/card.jpg');

// Card geometry. 1200x630 is the standard OG/Twitter large-image size; the
// caption bar is carved out of the bottom, so the heroes get the rest.
const WIDTH = 1200;
const HEIGHT = 630;
const BAR_HEIGHT = 104;
const IMAGE_HEIGHT = HEIGHT - BAR_HEIGHT;
// Heroes are ~1920-wide 16:9 shots; 1120px wide covers a 600px-wide half
// without upscaling.
const HERO_WIDTH = 1120;
const JPEG_QUALITY = 88;

// Site palette (index.html / public/icon.svg).
const BG = '#171410';
const CREAM = '#F2EDDF';
const PINK = '#E85D93';

const CAPTION = 'Two model-built levels. Rank them blind.';

// The site mark: rotated square outline + pink dot, on a transparent field.
const MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">` +
  `<rect x="4.5" y="4.5" width="13" height="13" transform="rotate(45 11 11)" fill="none" stroke="${CREAM}" stroke-width="1.4"/>` +
  `<circle cx="11" cy="11" r="3" fill="${PINK}"/>` +
  `</svg>`;
const MARK_URI = `data:image/svg+xml;utf8,${encodeURIComponent(MARK_SVG)}`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const ids = [];
  let out = defaultOut;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = path.resolve(root, argv[i + 1] ?? '');
      i += 1;
    } else {
      ids.push(argv[i]);
    }
  }
  if (ids.length !== 2) fail('Usage: node scripts/render-site-card.mjs <id-a> <id-b> [--out <path>]');
  return { ids, out };
}

async function heroDataUri(id) {
  const heroPath = path.join(contentDir, id, 'hero.avif');
  if (!fs.existsSync(heroPath)) fail(`No hero at ${path.relative(root, heroPath)}.`);
  const jpeg = await sharp(heroPath)
    .resize({ width: HERO_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

function heroHalf(src) {
  return h(
    'div',
    { style: { display: 'flex', width: WIDTH / 2, height: IMAGE_HEIGHT, overflow: 'hidden' } },
    h('img', { src, width: WIDTH / 2, height: IMAGE_HEIGHT, style: { objectFit: 'cover' } }),
  );
}

// A rotated-square diamond echoing the mark, with upright "VS" over it.
function vsBadge() {
  const size = 130;
  const inner = size * (100 / 140);
  const pad = (size - inner) / 2;
  return h(
    'div',
    {
      style: {
        position: 'absolute',
        left: WIDTH / 2 - size / 2,
        top: IMAGE_HEIGHT / 2 - size / 2,
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    h('div', {
      style: {
        position: 'absolute',
        left: pad,
        top: pad,
        width: inner,
        height: inner,
        background: BG,
        border: `3px solid ${CREAM}`,
        transform: 'rotate(45deg)',
      },
    }),
    h('div', { style: { display: 'flex', fontSize: 43, fontWeight: 700, letterSpacing: 2, color: CREAM } }, 'VS'),
  );
}

function lockup() {
  return h(
    'div',
    { style: { display: 'flex', alignItems: 'center' } },
    h('img', { src: MARK_URI, width: 38, height: 38 }),
    h(
      'div',
      { style: { display: 'flex', marginLeft: 14, fontSize: 26, fontWeight: 600, letterSpacing: 6, color: CREAM } },
      'PARETO RAIL',
    ),
  );
}

function card(heroA, heroB) {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: WIDTH, height: HEIGHT, background: BG } },
    h(
      'div',
      { style: { display: 'flex', position: 'relative', width: WIDTH, height: IMAGE_HEIGHT } },
      heroHalf(heroA),
      heroHalf(heroB),
      // Center divider, so two similarly lit heroes still read as two images.
      h('div', {
        style: { position: 'absolute', left: WIDTH / 2 - 1, top: 0, width: 2, height: IMAGE_HEIGHT, background: BG },
      }),
      vsBadge(),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: WIDTH,
          height: BAR_HEIGHT,
          padding: '0 40px',
        },
      },
      lockup(),
      h('div', { style: { display: 'flex', fontSize: 26, color: CREAM, opacity: 0.82 } }, CAPTION),
    ),
  );
}

const { ids, out } = parseArgs(process.argv.slice(2));
const [heroA, heroB] = await Promise.all(ids.map(heroDataUri));
const png = Buffer.from(await new ImageResponse(card(heroA, heroB), { width: WIDTH, height: HEIGHT }).arrayBuffer());
const jpeg = await sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, jpeg);
console.log(`Rendered ${ids[0]} vs ${ids[1]} -> ${path.relative(root, out)} (${WIDTH}x${HEIGHT})`);
