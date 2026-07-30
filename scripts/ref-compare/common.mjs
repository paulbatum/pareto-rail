import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_OUT_DIR = path.join(ROOT, 'tmp', 'ref-compare');

export function fail(message) {
  throw new Error(message);
}

/**
 * Options are `--name value`; names in `booleans` take no value and names in
 * `repeatable` collect into an array. Everything else is positional.
 */
export function parseArgs(argv, { booleans = [], repeatable = [] } = {}) {
  const booleanNames = new Set(['help', ...booleans]);
  const repeatableNames = new Set(repeatable);
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (!key) fail('Empty option name.');
    if (booleanNames.has(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for --${key}`);
    index += 1;
    if (repeatableNames.has(key)) (options[key] ??= []).push(value);
    else options[key] = value;
  }
  return { options, positionals };
}

export function assertOnlyOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) fail(`Unknown option --${key}`);
  }
}

export function requirePositionals(positionals, count, usage) {
  if (positionals.length !== count) fail(`Expected ${count} image argument(s).\n${usage}`);
  return positionals;
}

export function number(value, flag, { integer = false, min, max } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${flag} must be a number`);
  if (integer && !Number.isInteger(parsed)) fail(`${flag} must be an integer`);
  if (min !== undefined && parsed < min) fail(`${flag} must be at least ${min}`);
  if (max !== undefined && parsed > max) fail(`${flag} must be at most ${max}`);
  return parsed;
}

/** `left,top,width,height`, optionally prefixed with `name:`. */
export function parseRect(spec, { named = false } = {}) {
  const separator = spec.indexOf(':');
  let name;
  let body = spec;
  if (named && separator !== -1) {
    name = spec.slice(0, separator);
    body = spec.slice(separator + 1);
  }
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 4) fail(`Expected a rect of left,top,width,height but got "${spec}"`);
  const [left, top, width, height] = parts.map((part, index) => {
    const value = Number(part);
    if (!Number.isInteger(value)) fail(`Rect "${spec}" has a non-integer component`);
    if (index >= 2 && value <= 0) fail(`Rect "${spec}" must have a positive width and height`);
    if (index < 2 && value < 0) fail(`Rect "${spec}" must have a non-negative origin`);
    return value;
  });
  return { name, left, top, width, height };
}

/** `x,y`, optionally prefixed with `name=`. */
export function parsePoint(spec) {
  const separator = spec.indexOf('=');
  const name = separator === -1 ? undefined : spec.slice(0, separator);
  const body = separator === -1 ? spec : spec.slice(separator + 1);
  const parts = body.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || !parts.every((value) => Number.isInteger(value) && value >= 0)) {
    fail(`Expected a point of x,y but got "${spec}"`);
  }
  return { name: name ?? `${parts[0]},${parts[1]}`, x: parts[0], y: parts[1] };
}

/** Trim a rect to the image so a slightly oversized region crops instead of throwing. */
export function clampRect(rect, width, height) {
  const left = Math.min(rect.left, Math.max(0, width - 1));
  const top = Math.min(rect.top, Math.max(0, height - 1));
  return {
    ...rect,
    left,
    top,
    width: Math.max(1, Math.min(rect.width, width - left)),
    height: Math.max(1, Math.min(rect.height, height - top)),
  };
}

export async function readSize(file) {
  const metadata = await sharp(file).metadata();
  if (!metadata.width || !metadata.height) fail(`Could not read image dimensions: ${file}`);
  return { width: metadata.width, height: metadata.height };
}

export async function readPixels(file, size) {
  let pipeline = sharp(file);
  if (size) pipeline = pipeline.resize(size.width, size.height, { fit: 'fill' });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

export function pixelAt(image, x, y) {
  if (x >= image.width || y >= image.height) fail(`Point ${x},${y} is outside the ${image.width}x${image.height} image`);
  const index = (y * image.width + x) * image.channels;
  const r = image.data[index];
  const g = image.data[index + 1];
  const b = image.data[index + 2];
  return {
    r,
    g,
    b,
    hex: `0x${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`,
    luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
  };
}

/**
 * Measurement grid drawn in the image's own pixel coordinates, so a feature read
 * off one image can be looked up at the same numbers on the other.
 */
export function gridSvg(width, height, { spacing = 100, major = 500, horizon, center } = {}) {
  const parts = [`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`];
  for (let x = 0; x <= width; x += spacing) {
    const isMajor = x % major === 0;
    parts.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${isMajor ? '#00ff00' : '#00ffff'}" stroke-width="${isMajor ? 2 : 1}" opacity="0.6"/>`,
      `<text x="${x + 3}" y="18" fill="#00ff00" font-size="16" font-family="monospace">${x}</text>`,
    );
  }
  for (let y = 0; y <= height; y += spacing) {
    const isMajor = y % major === 0;
    parts.push(
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${isMajor ? '#00ff00' : '#00ffff'}" stroke-width="${isMajor ? 2 : 1}" opacity="0.6"/>`,
      `<text x="3" y="${y - 4}" fill="#00ff00" font-size="16" font-family="monospace">${y}</text>`,
    );
  }
  if (horizon !== undefined) parts.push(`<line x1="0" y1="${horizon}" x2="${width}" y2="${horizon}" stroke="#ff0000" stroke-width="2"/>`);
  if (center !== undefined) parts.push(`<line x1="${center}" y1="0" x2="${center}" y2="${height}" stroke="#ff0000" stroke-width="2"/>`);
  parts.push('</svg>');
  return Buffer.from(parts.join(''));
}

export function gridOptions(options) {
  return {
    spacing: options.spacing === undefined ? undefined : number(options.spacing, '--spacing', { integer: true, min: 2 }),
    major: options.major === undefined ? undefined : number(options.major, '--major', { integer: true, min: 2 }),
    horizon: options.horizon === undefined ? undefined : number(options.horizon, '--horizon', { integer: true, min: 0 }),
  };
}

/** Grid-annotated copy of an image, as a PNG buffer at the source resolution. */
export async function withGrid(file, gridOpts = {}) {
  const { width, height } = await readSize(file);
  const center = gridOpts.center ?? Math.round(width / 2);
  return sharp(file)
    .composite([{ input: gridSvg(width, height, { ...gridOpts, center }) }])
    .png()
    .toBuffer();
}

export async function resolveOut(value, fallbackName) {
  const target = value ? path.resolve(ROOT, value) : path.join(DEFAULT_OUT_DIR, fallbackName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  return target;
}

export async function resolveOutDir(value, fallbackName) {
  const target = value ? path.resolve(ROOT, value) : path.join(DEFAULT_OUT_DIR, fallbackName);
  await fs.mkdir(target, { recursive: true });
  return target;
}

export function report(outputPath, note) {
  const shown = path.relative(process.cwd(), outputPath);
  console.log(note ? `${shown}  ${note}` : shown);
}
