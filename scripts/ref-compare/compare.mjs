import sharp from 'sharp';
import { assertOnlyOptions, clampRect, gridOptions, gridSvg, number, parseArgs, parseRect, readSize, report, requirePositionals, resolveOut } from './common.mjs';

const GUTTER = 10;
const MAX_OUTPUT_WIDTH = 1600;

export const usage = `refcompare compare <reference> <render> --region [name:]<l,t,w,h> [--zoom auto] [--grid] [--size <WxH>] [--out <file>]
  Stack the same region from both images, reference on top, for a like-for-like read.
  Both frames are scaled to the reference resolution first, so one region reads the same on each.`;

export async function run(argv) {
  const { options, positionals } = parseArgs(argv, { booleans: ['grid'] });
  assertOnlyOptions(options, ['region', 'zoom', 'grid', 'size', 'out', 'spacing', 'major', 'horizon']);
  const [reference, render] = requirePositionals(positionals, 2, usage);
  if (!options.region) throw new Error(`--region is required.\n${usage}`);

  const canvas = await resolveCanvas(options.size, reference);
  const rect = clampRect(parseRect(options.region, { named: true }), canvas.width, canvas.height);
  const grid = options.grid ? gridOptions(options) : undefined;
  const panels = [];
  for (const source of [reference, render]) {
    const scaled = await sharp(source).resize(canvas.width, canvas.height, { fit: 'fill' }).png().toBuffer();
    const input = grid
      ? await sharp(scaled)
          .composite([{ input: gridSvg(canvas.width, canvas.height, { ...grid, center: Math.round(canvas.width / 2) }) }])
          .png()
          .toBuffer()
      : scaled;
    panels.push(await sharp(input).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).toBuffer());
  }

  const zoom =
    options.zoom === undefined || options.zoom === 'auto'
      ? Math.max(1, Math.min(2, Math.floor(MAX_OUTPUT_WIDTH / rect.width)))
      : number(options.zoom, '--zoom', { min: 0.1 });
  const width = Math.max(1, Math.round(rect.width * zoom));
  const height = Math.max(1, Math.round(rect.height * zoom));
  const scaled = [];
  for (const panel of panels) scaled.push(await sharp(panel).resize(width, height, { fit: 'fill' }).png().toBuffer());

  const out = await resolveOut(options.out, `compare-${rect.name ?? `${rect.left}-${rect.top}`}.png`);
  await sharp({ create: { width, height: height * 2 + GUTTER, channels: 3, background: '#ff00ff' } })
    .composite([
      { input: scaled[0], top: 0, left: 0 },
      { input: scaled[1], top: height + GUTTER, left: 0 },
    ])
    .png()
    .toFile(out);
  report(out, `region ${rect.left},${rect.top} ${rect.width}x${rect.height} @${zoom}x on a ${canvas.width}x${canvas.height} canvas (reference on top)`);
}

async function resolveCanvas(size, reference) {
  if (!size) return readSize(reference);
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error('--size must look like 1920x1080');
  return { width: Number(match[1]), height: Number(match[2]) };
}
