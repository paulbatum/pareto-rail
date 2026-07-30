import fs from 'node:fs/promises';
import path from 'node:path';
import { assertOnlyOptions, parseArgs, parsePoint, pixelAt, readPixels, readSize } from './common.mjs';

export const usage = `refcompare sample <image> [<image> ...] --at [name=]<x,y> [--at ...] [--points <file.json>] [--size <WxH>]
  Print the hex colour and luminance at named pixels. With two images, also print the luminance delta.
  Later images are scaled to the first one's resolution, so one coordinate list works across sizes.
  A points file is { "name": [x, y], ... }.`;

export async function run(argv) {
  const { options, positionals } = parseArgs(argv, { repeatable: ['at'] });
  assertOnlyOptions(options, ['at', 'points', 'size']);
  if (positionals.length === 0) throw new Error(`At least one image is required.\n${usage}`);

  const points = [...(await filePoints(options.points)), ...(options.at ?? []).map(parsePoint)];
  if (points.length === 0) throw new Error(`At least one --at or --points entry is required.\n${usage}`);

  const canvas = await resolveCanvas(options.size, positionals[0]);
  const images = [];
  for (const source of positionals) images.push({ label: path.basename(source), pixels: await readPixels(source, canvas) });

  const nameWidth = Math.max(...points.map((point) => point.name.length), 'point'.length);
  const columnWidth = Math.max(...images.map((image) => image.label.length), ' 0xffffff lum 0.00'.length);
  const header = images.map((image) => image.label.padEnd(columnWidth)).join('  ');
  console.log(`${'point'.padEnd(nameWidth)}  ${header}${images.length === 2 ? '  Δlum' : ''}`);

  for (const point of points) {
    const samples = images.map((image) => pixelAt(image.pixels, point.x, point.y));
    const cells = samples.map((sample) => `${sample.hex} lum ${sample.luminance.toFixed(2)}`.padEnd(columnWidth));
    const delta = images.length === 2 ? `  ${(samples[1].luminance - samples[0].luminance >= 0 ? '+' : '')}${(samples[1].luminance - samples[0].luminance).toFixed(2)}` : '';
    console.log(`${point.name.padEnd(nameWidth)}  ${cells.join('  ')}${delta}`);
  }
}

async function resolveCanvas(size, first) {
  if (!size) return readSize(first);
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error('--size must look like 1920x1080');
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function filePoints(file) {
  if (!file) return [];
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  return Object.entries(parsed).map(([name, value]) => {
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`Point "${name}" must be [x, y]`);
    return { name, x: value[0], y: value[1] };
  });
}
