import path from 'node:path';
import sharp from 'sharp';
import { assertOnlyOptions, gridOptions, gridSvg, number, parseArgs, readSize, report, requirePositionals, resolveOut } from './common.mjs';

export const usage = `refcompare grid <image> [--out <file>] [--spacing 100] [--major 500] [--horizon <y>] [--center <x>] [--size <WxH>]
  Overlay a labelled measurement grid so features can be read off in pixel coordinates.`;

export async function run(argv) {
  const { options, positionals } = parseArgs(argv);
  assertOnlyOptions(options, ['out', 'spacing', 'major', 'horizon', 'center', 'size']);
  const [source] = requirePositionals(positionals, 1, usage);

  let { width, height } = await readSize(source);
  let pipeline = sharp(source);
  if (options.size) {
    const match = /^(\d+)x(\d+)$/.exec(options.size);
    if (!match) throw new Error('--size must look like 1920x1080');
    width = Number(match[1]);
    height = Number(match[2]);
    pipeline = pipeline.resize(width, height, { fit: 'fill' });
  }

  const grid = gridOptions(options);
  const center = options.center === undefined ? Math.round(width / 2) : number(options.center, '--center', { integer: true, min: 0 });
  const out = await resolveOut(options.out, `${path.basename(source, path.extname(source))}-grid.png`);
  await pipeline
    .composite([{ input: gridSvg(width, height, { ...grid, center }) }])
    .png()
    .toFile(out);
  report(out, `${width}x${height}`);
}
