import sharp from 'sharp';
import { assertOnlyOptions, number, parseArgs, readSize, report, requirePositionals, resolveOut } from './common.mjs';

const GUTTER = 8;
const DEFAULT_WIDTH = 1180;

export const usage = `refcompare stack <reference> <render> [--width 1180] [--out <file>]
  Stack both full frames at a matched width, reference on top, for composition and framing.`;

export async function run(argv) {
  const { options, positionals } = parseArgs(argv);
  assertOnlyOptions(options, ['width', 'out']);
  const [reference, render] = requirePositionals(positionals, 2, usage);

  const width = options.width === undefined ? DEFAULT_WIDTH : number(options.width, '--width', { integer: true, min: 16 });
  const size = await readSize(reference);
  const height = Math.round((width * size.height) / size.width);
  const panels = [];
  for (const source of [reference, render]) {
    panels.push(await sharp(source).resize(width, height, { fit: 'fill' }).toBuffer());
  }

  const out = await resolveOut(options.out, 'stack.png');
  await sharp({ create: { width, height: height * 2 + GUTTER, channels: 3, background: '#ff00ff' } })
    .composite([
      { input: panels[0], top: 0, left: 0 },
      { input: panels[1], top: height + GUTTER, left: 0 },
    ])
    .png()
    .toFile(out);
  report(out, `${width}x${height} panels (reference on top)`);
}
