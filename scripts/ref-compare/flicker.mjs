import sharp from 'sharp';
import { assertOnlyOptions, number, parseArgs, parseRect, readPixels, report, requirePositionals, resolveOut } from './common.mjs';

const DEFAULTS = { threshold: 24, cell: 8, minPixels: 120, top: 12, fill: 0.25 };

export const usage = `refcompare flicker <frame-a> <frame-b> [--threshold 24] [--cell 8] [--cell-min <n>] [--min-pixels 120] [--ignore <l,t,w,h>]... [--top 12] [--json] [--out <file>]
  Diff two captures of the same scene taken a small time-step apart and report where they disagree.
  Capture the pair yourself, and keep the step small so the camera barely moves, e.g.
  npm run snapshot:gameplay -- --level <id> --time 5 and --time 5.05.
  Sparse high-contrast speckle over a wide box is shimmer or z-fighting; a dense blob is animation.
  Pass --ignore for regions that are meant to move (enemies, effects, HUD).`;

export async function run(argv) {
  const { options, positionals } = parseArgs(argv, { booleans: ['json'], repeatable: ['ignore'] });
  assertOnlyOptions(options, ['threshold', 'cell', 'cell-min', 'min-pixels', 'ignore', 'top', 'json', 'out', 'fill']);
  const [fileA, fileB] = requirePositionals(positionals, 2, usage);

  const cell = options.cell === undefined ? DEFAULTS.cell : number(options.cell, '--cell', { integer: true, min: 1 });
  const settings = {
    threshold: options.threshold === undefined ? DEFAULTS.threshold : number(options.threshold, '--threshold', { integer: true, min: 1, max: 255 }),
    cell,
    cellMin: options['cell-min'] === undefined ? Math.max(2, Math.round(cell * cell * 0.25)) : number(options['cell-min'], '--cell-min', { integer: true, min: 1 }),
    minPixels: options['min-pixels'] === undefined ? DEFAULTS.minPixels : number(options['min-pixels'], '--min-pixels', { integer: true, min: 1 }),
    top: options.top === undefined ? DEFAULTS.top : number(options.top, '--top', { integer: true, min: 1 }),
    fill: options.fill === undefined ? DEFAULTS.fill : number(options.fill, '--fill', { min: 0, max: 1 }),
  };
  const ignored = (options.ignore ?? []).map((spec) => parseRect(spec));

  const a = await readPixels(fileA);
  const b = await readPixels(fileB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Frames differ in size: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }

  const delta = deltaMap(a, b, ignored);
  const regions = findRegions(delta, a.width, a.height, settings);
  const changed = countAbove(delta, settings.threshold);

  const out = await resolveOut(options.out, 'flicker.png');
  await writeHeatmap(out, a, delta, regions, ignored, settings);

  const summary = {
    frames: [fileA, fileB],
    width: a.width,
    height: a.height,
    threshold: settings.threshold,
    changedPixels: changed,
    changedRatio: changed / (a.width * a.height),
    ignored,
    regions,
    heatmap: out,
  };
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  printSummary(summary, settings);
  report(out, 'heatmap');
}

/** Per-pixel maximum channel difference, with ignored rects forced to zero. */
function deltaMap(a, b, ignored) {
  const map = new Uint8Array(a.width * a.height);
  for (let index = 0; index < map.length; index += 1) {
    const offsetA = index * a.channels;
    const offsetB = index * b.channels;
    const dr = Math.abs(a.data[offsetA] - b.data[offsetB]);
    const dg = Math.abs(a.data[offsetA + 1] - b.data[offsetB + 1]);
    const db = Math.abs(a.data[offsetA + 2] - b.data[offsetB + 2]);
    map[index] = Math.max(dr, dg, db);
  }
  for (const rect of ignored) {
    const right = Math.min(a.width, rect.left + rect.width);
    const bottom = Math.min(a.height, rect.top + rect.height);
    for (let y = Math.max(0, rect.top); y < bottom; y += 1) {
      map.fill(0, y * a.width + Math.max(0, rect.left), y * a.width + right);
    }
  }
  return map;
}

function countAbove(map, threshold) {
  let count = 0;
  for (let index = 0; index < map.length; index += 1) if (map[index] >= threshold) count += 1;
  return count;
}

/**
 * Cluster changed pixels on a coarse cell grid so scattered z-fight speckle groups
 * into one reportable region instead of thousands of single-pixel components.
 */
function findRegions(map, width, height, { threshold, cell, cellMin, minPixels, top, fill: fillLimit }) {
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const counts = new Int32Array(columns * rows);
  const sums = new Float64Array(columns * rows);
  const maxima = new Uint8Array(columns * rows);

  for (let y = 0; y < height; y += 1) {
    const cellRow = (y / cell) | 0;
    for (let x = 0; x < width; x += 1) {
      const value = map[y * width + x];
      if (value < threshold) continue;
      const cellIndex = cellRow * columns + ((x / cell) | 0);
      counts[cellIndex] += 1;
      sums[cellIndex] += value;
      if (value > maxima[cellIndex]) maxima[cellIndex] = value;
    }
  }

  // A cell only joins a region once enough of it changed. Without this, single-pixel
  // parallax edges chain every region in a moving-camera frame into one blob.
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] < cellMin) counts[index] = 0;
  }

  const seen = new Uint8Array(columns * rows);
  const regions = [];
  for (let start = 0; start < counts.length; start += 1) {
    if (seen[start] || counts[start] === 0) continue;
    const stack = [start];
    seen[start] = 1;
    let pixels = 0;
    let sum = 0;
    let peak = 0;
    let minColumn = columns;
    let maxColumn = -1;
    let minRow = rows;
    let maxRow = -1;
    while (stack.length > 0) {
      const index = stack.pop();
      const column = index % columns;
      const row = (index / columns) | 0;
      pixels += counts[index];
      sum += sums[index];
      if (maxima[index] > peak) peak = maxima[index];
      if (column < minColumn) minColumn = column;
      if (column > maxColumn) maxColumn = column;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nextColumn = column + dx;
          const nextRow = row + dy;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) continue;
          const next = nextRow * columns + nextColumn;
          if (seen[next] || counts[next] === 0) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (pixels < minPixels) continue;
    const box = {
      left: minColumn * cell,
      top: minRow * cell,
      width: Math.min(width, (maxColumn + 1) * cell) - minColumn * cell,
      height: Math.min(height, (maxRow + 1) * cell) - minRow * cell,
    };
    const density = pixels / (box.width * box.height);
    regions.push({
      box,
      pixels,
      density: Number(density.toFixed(3)),
      meanDelta: Number((sum / pixels).toFixed(1)),
      maxDelta: peak,
      kind: density < fillLimit ? 'speckle' : 'solid',
    });
  }

  regions.sort((left, right) => right.pixels - left.pixels);
  return regions.slice(0, top);
}

function printSummary(summary, settings) {
  const percent = (summary.changedRatio * 100).toFixed(2);
  console.log(
    `${summary.width}x${summary.height}  changed ${summary.changedPixels} px (${percent}%)  threshold ${settings.threshold}  cell ${settings.cell}` +
      (summary.ignored.length > 0 ? `  ignored ${summary.ignored.length} region(s)` : ''),
  );
  if (summary.regions.length === 0) {
    console.log('no region above --min-pixels; the frames are effectively identical');
    return;
  }
  console.log('  #  kind     box                        px      density  mean  max');
  for (const [index, region] of summary.regions.entries()) {
    const box = `${region.box.left},${region.box.top} ${region.box.width}x${region.box.height}`;
    console.log(
      `  ${String(index + 1).padStart(2)}  ${region.kind.padEnd(7)}  ${box.padEnd(24)}  ${String(region.pixels).padStart(6)}  ${region.density
        .toFixed(2)
        .padStart(7)}  ${String(region.meanDelta).padStart(4)}  ${String(region.maxDelta).padStart(3)}`,
    );
  }
  console.log('speckle = sparse change over a wide box (shimmer or z-fighting); solid = coherent blob (animation)');
}

async function writeHeatmap(out, base, delta, regions, ignored, { threshold }) {
  const pixels = Buffer.alloc(base.width * base.height * 3);
  for (let index = 0; index < delta.length; index += 1) {
    const offset = index * base.channels;
    const luminance = (0.2126 * base.data[offset] + 0.7152 * base.data[offset + 1] + 0.0722 * base.data[offset + 2]) * 0.35;
    const value = delta[index];
    const target = index * 3;
    if (value < threshold) {
      pixels[target] = luminance;
      pixels[target + 1] = luminance;
      pixels[target + 2] = luminance;
      continue;
    }
    const [r, g, b] = ramp((value - threshold) / Math.max(1, 255 - threshold));
    pixels[target] = r;
    pixels[target + 1] = g;
    pixels[target + 2] = b;
  }

  const boxes = [`<svg width="${base.width}" height="${base.height}" xmlns="http://www.w3.org/2000/svg">`];
  for (const rect of ignored) {
    boxes.push(
      `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="none" stroke="#3388ff" stroke-width="2" stroke-dasharray="8 6"/>`,
    );
  }
  for (const [index, region] of regions.entries()) {
    const stroke = region.kind === 'speckle' ? '#ff00ff' : '#00ff88';
    boxes.push(
      `<rect x="${region.box.left}" y="${region.box.top}" width="${region.box.width}" height="${region.box.height}" fill="none" stroke="${stroke}" stroke-width="2"/>`,
      `<text x="${region.box.left + 4}" y="${Math.max(14, region.box.top - 4)}" fill="${stroke}" font-size="16" font-family="monospace">${index + 1}</text>`,
    );
  }
  boxes.push('</svg>');

  await sharp(pixels, { raw: { width: base.width, height: base.height, channels: 3 } })
    .composite([{ input: Buffer.from(boxes.join('')) }])
    .png()
    .toFile(out);
}

/** Cool to hot, so a glance separates faint drift from hard flipping. */
function ramp(t) {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.5) {
    const k = clamped * 2;
    return [Math.round(255 * k), Math.round(64 + 191 * k), Math.round(255 * (1 - k))];
  }
  const k = (clamped - 0.5) * 2;
  return [255, Math.round(255 * (1 - k)), 0];
}
