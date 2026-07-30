import path from 'node:path';
import sharp from 'sharp';
import {
  assertOnlyOptions,
  clampRect,
  gridOptions,
  number,
  parseArgs,
  parseRect,
  readSize,
  report,
  requirePositionals,
  resolveOutDir,
  withGrid,
} from './common.mjs';

export const usage = `refcompare crop <image> --region [name:]<l,t,w,h> [--region ...] [--zoom 2] [--grid] [--out <dir>]
  Cut named regions and enlarge them, for close reading of one image.`;

export async function run(argv) {
  const { options, positionals } = parseArgs(argv, { booleans: ['grid'], repeatable: ['region'] });
  assertOnlyOptions(options, ['region', 'zoom', 'grid', 'out', 'spacing', 'major', 'horizon']);
  const [source] = requirePositionals(positionals, 1, usage);
  const specs = options.region ?? [];
  if (specs.length === 0) throw new Error(`At least one --region is required.\n${usage}`);

  const zoom = options.zoom === undefined ? 2 : number(options.zoom, '--zoom', { min: 0.1 });
  const { width, height } = await readSize(source);
  const input = options.grid ? await withGrid(source, gridOptions(options)) : source;
  const outDir = await resolveOutDir(options.out, `${path.basename(source, path.extname(source))}-crops`);

  for (const [index, spec] of specs.entries()) {
    const rect = clampRect(parseRect(spec, { named: true }), width, height);
    const name = rect.name ?? `region-${index + 1}`;
    const out = path.join(outDir, `${name}.png`);
    await sharp(input)
      .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      .resize({ width: Math.max(1, Math.round(rect.width * zoom)) })
      .png()
      .toFile(out);
    report(out, `${rect.left},${rect.top} ${rect.width}x${rect.height} @${zoom}x`);
  }
}
