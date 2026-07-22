#!/usr/bin/env node
// Converts every committed level hero (AVIF) into a JPEG the social-card OG
// function can decode, run after `vite build` in the build script.
//
// Level heroes are committed only as AVIF (`public/level-content/<id>/hero.avif`);
// `@vercel/og`/satori cannot decode AVIF, and the match OG endpoint composites two
// heroes into the 1200x630 share card. This step rasterizes each hero to
// `dist/social/heroes/<id>.jpg`, a deployed static path the OG function (and the
// edge middleware's card URL) fetches from the same origin. The JPEGs are emitted
// into gitignored `dist/`, so nothing is committed and the tracked-PNG guard is
// moot (JPEG anyway). Heroes are ~1920-wide 16:9 game screenshots; 1120px wide
// puts them at 630px tall, so the 600x630 half-card cover-crop never upscales.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUTPUT_WIDTH = 1120;
const JPEG_QUALITY = 80;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'public/level-content');
const outputDir = path.join(root, 'dist/social/heroes');

function fail(message) {
  throw new Error(message);
}

async function main() {
  if (!fs.existsSync(contentDir)) fail(`level-content directory not found at ${path.relative(root, contentDir)}.`);
  if (!fs.existsSync(path.join(root, 'dist'))) {
    fail('dist directory not found; run vite build before generate-social-heroes.');
  }

  const ids = fs
    .readdirSync(contentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  fs.mkdirSync(outputDir, { recursive: true });

  let converted = 0;
  for (const id of ids) {
    const heroPath = path.join(contentDir, id, 'hero.avif');
    if (!fs.existsSync(heroPath)) continue; // a level-content dir without a hero is not a card source
    const outputPath = path.join(outputDir, `${id}.jpg`);
    try {
      await sharp(heroPath)
        .resize({ width: OUTPUT_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(outputPath);
    } catch (error) {
      fail(`Failed to convert ${path.relative(root, heroPath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    converted += 1;
  }

  if (converted === 0) fail('No hero.avif files found under public/level-content; expected at least one.');
  console.log(`Generated ${converted} social hero JPEG(s) into dist/social/heroes/.`);
}

main().catch((error) => {
  console.error(`Social hero generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
