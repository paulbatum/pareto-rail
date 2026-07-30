import { assertOnlyOptions, number, parseArgs, readSize, report, requirePositionals, resolveOut } from './common.mjs';
import sharp from 'sharp';

export const usage = `refcompare blend <reference> <render> [--opacity 0.5] [--out <file>]
  Ghost the reference over the render at the render's resolution; misalignment shows as doubled edges.`;

export async function run(argv) {
  const { options, positionals } = parseArgs(argv);
  assertOnlyOptions(options, ['opacity', 'out']);
  const [reference, render] = requirePositionals(positionals, 2, usage);

  const opacity = options.opacity === undefined ? 0.5 : number(options.opacity, '--opacity', { min: 0, max: 1 });
  const { width, height } = await readSize(render);
  const ghost = await sharp(reference).resize(width, height, { fit: 'fill' }).ensureAlpha(opacity).toBuffer();
  const out = await resolveOut(options.out, 'blend.png');
  await sharp(render).resize(width, height, { fit: 'fill' }).composite([{ input: ghost, blend: 'over' }]).png().toFile(out);
  report(out, `${width}x${height} reference at ${opacity} over render`);
}
