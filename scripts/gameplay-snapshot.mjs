#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_OUT = 'snapshots/gameplay';
const DEFAULT_DT = 1 / 60;
const DEFAULT_THUMB_WIDTH = 320;
const DEFAULT_GUTTER = 8;
const FIDELITIES = ['full', 'postless', 'flat'];
const LOW_LUMINANCE = 0.002;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(root, options.out);
  await fs.mkdir(outDir, { recursive: true });

  const server = await createServer({
    root,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  });

  let browser;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine Vite dev server port');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    browser = await puppeteer.launch({
      headless: true,
      executablePath: findChromeExecutable(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--disable-gpu-sandbox',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
      ],
    });

    const metadata = await readLevelMetadata(browser, baseUrl, options);
    options.metadata = metadata;
    resolveMusicalTimes(options);

    if (options.sheet) {
      await captureSheet(browser, baseUrl, outDir, options);
      return;
    }

    for (const time of options.times) await captureStill(browser, baseUrl, outDir, options, time);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

async function captureStill(browser, baseUrl, outDir, options, time) {
  const result = await captureWithFallbacks(browser, baseUrl, options, time);
  const label = options.musicalLabels[time];
  const timeLabel = label ? `${formatTime(time)}-${label}` : formatTime(time);
  const outputPath = path.join(outDir, `${safeName(options.level)}-${timeLabel}-${result.fidelity}${projectileSuffix(options)}${mortalitySuffix(options)}${startScreenSuffix(options)}.png`);
  await fs.writeFile(outputPath, addSnapshotSeedTextChunk(decodePngDataUrl(result.dataUrl), result.seed));
  logCapture(outputPath, result);
}

async function captureSheet(browser, baseUrl, outDir, options) {
  const times = options.times.length > 0 ? options.times : await makeEvenTimes(browser, baseUrl, options);
  if (times.length === 0) throw new Error('No thumbnail times to capture');

  const captures = [];
  for (const time of times) {
    const result = await captureWithFallbacks(browser, baseUrl, options, time);
    const label = options.musicalLabels[time] || '';
    captures.push({ ...result, time, label });
    logCapture(null, result, time);
  }

  const dataUrl = await composeSheet(browser, captures, options);
  const fidelityLabel = uniqueValues(captures.map((capture) => capture.fidelity)).length === 1 ? captures[0].fidelity : 'mixed';
  const firstTime = captures[0].time;
  const lastTime = captures[captures.length - 1].time;
  const sheetType = options.sections ? 'sections-' : '';
  const outputPath = path.join(
    outDir,
    `${safeName(options.level)}-${sheetType}thumbnails-${captures.length}-${formatTime(firstTime)}-to-${formatTime(lastTime)}-${fidelityLabel}${projectileSuffix(options)}${mortalitySuffix(options)}${startScreenSuffix(options)}.png`,
  );
  await fs.writeFile(outputPath, addSnapshotSeedTextChunk(decodePngDataUrl(dataUrl), captures[0].seed));
  console.log(`${path.relative(process.cwd(), outputPath)} thumbnails=${captures.length} fidelity=${fidelityLabel}`);
}

async function makeEvenTimes(browser, baseUrl, options) {
  const duration = options.metadata.duration;
  return Array.from({ length: options.thumbnailCount }, (_, index) => duration * ((index + 0.5) / options.thumbnailCount));
}

async function readLevelMetadata(browser, baseUrl, options) {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[page] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.error(`[page] ${error.message}`));

  try {
    await page.setViewport({ width: options.width, height: options.height, deviceScaleFactor: 1 });
    const url = newGameplaySnapshotUrl(baseUrl, { ...options, startScreen: false }, 0, 'postless');
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => window.__gameplaySnapshot.ready);
    const metadata = await page.evaluate(() => window.__gameplaySnapshot.metadata());
    if (!metadata || !Number.isFinite(metadata.duration) || metadata.duration <= 0) {
      throw new Error(`Could not read level metadata for ${options.level}`);
    }
    return metadata;
  } finally {
    await page.close();
  }
}

async function captureWithFallbacks(browser, baseUrl, options, time) {
  const fidelities = options.fidelity === 'auto' ? FIDELITIES : [options.fidelity];
  const failures = [];
  for (const fidelity of fidelities) {
    try {
      return await captureOnce(browser, baseUrl, options, time, fidelity);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${fidelity}: ${message}`);
      if (options.fidelity === 'auto') console.warn(`gameplay snapshot ${fidelity} failed at ${time}s; retrying fallback`);
    }
  }
  throw new Error(`All gameplay snapshot fidelities failed at ${time}s:\n${failures.join('\n')}`);
}

async function captureOnce(browser, baseUrl, options, time, fidelity) {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[page] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.error(`[page] ${error.message}`));

  try {
    await page.setViewport({ width: options.width, height: options.height, deviceScaleFactor: 1 });
    const url = newGameplaySnapshotUrl(baseUrl, options, time, fidelity);
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => window.__gameplaySnapshot.ready);
    const result = await page.evaluate(() => window.__gameplaySnapshot.capture());
    if (!result || typeof result.dataUrl !== 'string') throw new Error('Capture did not return a data URL');
    return result;
  } finally {
    await page.close();
  }
}

function newGameplaySnapshotUrl(baseUrl, options, time, fidelity) {
  const url = new URL('/gameplay-snapshot.html', baseUrl);
  url.searchParams.set('level', options.level);
  url.searchParams.set('time', String(time));
  url.searchParams.set('dt', String(options.dt));
  url.searchParams.set('width', String(options.width));
  url.searchParams.set('height', String(options.height));
  url.searchParams.set('fidelity', fidelity);
  if (options.immortal) url.searchParams.set('immortal', '1');
  if (options.startScreen) url.searchParams.set('startScreen', '1');
  if (options.projectiles) url.searchParams.set('projectiles', '1');
  if (options.debugValue !== undefined) url.searchParams.set('debugValue', options.debugValue);
  if (options.seed !== undefined) url.searchParams.set('seed', String(options.seed));
  return url;
}

async function composeSheet(browser, captures, options) {
  const page = await browser.newPage();
  try {
    const dataUrl = await page.evaluate(
      async ({ captures: serializableCaptures, thumbWidth, sourceWidth, sourceHeight, columns, gutter }) => {
        const thumbHeight = Math.round(thumbWidth * (sourceHeight / sourceWidth));
        const labelHeight = 24;
        const rows = Math.ceil(serializableCaptures.length / columns);
        const canvas = document.createElement('canvas');
        canvas.width = columns * thumbWidth + (columns + 1) * gutter;
        canvas.height = rows * (thumbHeight + labelHeight) + (rows + 1) * gutter;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create sheet canvas context');

        context.fillStyle = '#05060a';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = '14px ui-monospace, Menlo, monospace';
        context.textBaseline = 'middle';

        const images = await Promise.all(
          serializableCaptures.map(
            (capture) =>
              new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error(`Could not load capture at ${capture.time}s`));
                image.src = capture.dataUrl;
              }),
          ),
        );

        serializableCaptures.forEach((capture, index) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          const x = gutter + column * (thumbWidth + gutter);
          const y = gutter + row * (thumbHeight + labelHeight + gutter);
          context.drawImage(images[index], x, y, thumbWidth, thumbHeight);
          context.fillStyle = 'rgba(2, 4, 10, 0.82)';
          context.fillRect(x, y + thumbHeight, thumbWidth, labelHeight);
          context.fillStyle = '#d8f6ff';
          const labelPart = capture.label ? ` (${capture.label})` : '';
          context.fillText(`${capture.time.toFixed(1)}s${labelPart} · ${capture.fidelity} · ${capture.state}`, x + 8, y + thumbHeight + labelHeight / 2);
        });

        return canvas.toDataURL('image/png');
      },
      {
        captures: captures.map(({ dataUrl, time, fidelity, state, label }) => ({ dataUrl, time, fidelity, state, label })),
        thumbWidth: options.thumbWidth,
        sourceWidth: options.width,
        sourceHeight: options.height,
        columns: options.columns ?? defaultColumns(captures.length),
        gutter: DEFAULT_GUTTER,
      },
    );
    if (typeof dataUrl !== 'string') throw new Error('Sheet composition did not return a data URL');
    return dataUrl;
  } finally {
    await page.close();
  }
}

function parseArgs(argv) {
  const parsed = {
    level: undefined,
    times: [],
    out: DEFAULT_OUT,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    dt: DEFAULT_DT,
    fidelity: 'auto',
    immortal: true,
    startScreen: false,
    projectiles: false,
    debugValue: undefined,
    seed: undefined,
    sheet: false,
    thumbnailCount: undefined,
    thumbWidth: DEFAULT_THUMB_WIDTH,
    columns: undefined,
    atsRaw: [],
    sections: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);

    if (key === 'immortal') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        parsed.immortal = readBoolean(next, '--immortal');
        i += 1;
      } else {
        parsed.immortal = true;
      }
      continue;
    }

    if (key === 'mortal') {
      parsed.immortal = false;
      continue;
    }

    if (key === 'sheet') {
      parsed.sheet = true;
      continue;
    }

    if (key === 'sections') {
      parsed.sections = true;
      parsed.sheet = true;
      continue;
    }

    if (key === 'start-screen') {
      parsed.startScreen = true;
      continue;
    }

    if (key === 'projectiles') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        parsed.projectiles = readBoolean(next, '--projectiles');
        i += 1;
      } else {
        parsed.projectiles = true;
      }
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i += 1;

    switch (key) {
      case 'level':
        parsed.level = value;
        break;
      case 'time':
        parsed.times.push(readNonNegativeNumber(value, '--time'));
        break;
      case 'times':
        parsed.times.push(...readTimes(value));
        break;
      case 'at':
        parsed.atsRaw.push(value);
        break;
      case 'ats':
        parsed.atsRaw.push(...value.split(',').map((part) => part.trim()).filter((part) => part.length > 0));
        break;
      case 'out':
        parsed.out = value;
        break;
      case 'width':
        parsed.width = readPositiveInteger(value, '--width');
        break;
      case 'height':
        parsed.height = readPositiveInteger(value, '--height');
        break;
      case 'dt':
        parsed.dt = readPositiveNumber(value, '--dt');
        break;
      case 'fidelity':
        if (value !== 'auto' && !FIDELITIES.includes(value)) throw new Error('--fidelity must be auto, full, postless, or flat');
        parsed.fidelity = value;
        break;
      case 'debug-value':
      case 'debugValue':
        parsed.debugValue = value;
        break;
      case 'seed':
        parsed.seed = readInteger(value, '--seed');
        break;
      case 'thumbnails':
      case 'thumbnail-count':
      case 'thumbnailCount':
        parsed.thumbnailCount = readPositiveInteger(value, `--${key}`);
        parsed.sheet = true;
        break;
      case 'thumb-width':
      case 'thumbWidth':
        parsed.thumbWidth = readPositiveInteger(value, `--${key}`);
        break;
      case 'columns':
        parsed.columns = readPositiveInteger(value, '--columns');
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.level) throw new Error('Missing required option: --level <id>');
  if (parsed.startScreen && parsed.times.length === 0 && parsed.atsRaw.length === 0) parsed.times.push(0.8);
  const hasTimeInput = parsed.times.length > 0 || parsed.atsRaw.length > 0 || parsed.sections || parsed.thumbnailCount !== undefined;
  if (parsed.sheet) {
    if (!hasTimeInput) {
      throw new Error('Sheet mode requires --thumbnails <count>, --times <seconds,...>, --at <bar:beat>, --ats <list>, or --sections');
    }
  } else if (!hasTimeInput) {
    throw new Error('Missing required option: --time <seconds>, --times <seconds,...>, --at <bar:beat>, --ats <list>, --sections, or --thumbnails <count>');
  }
  return parsed;
}

function readTimes(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => readNonNegativeNumber(part, '--times'));
}

function readPositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function readInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} must be an integer`);
  return parsed;
}

function readPositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number`);
  return parsed;
}

function readNonNegativeNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number`);
  return parsed;
}

function readBoolean(value, flag) {
  if (value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  throw new Error(`${flag} must be a boolean value`);
}

function logCapture(outputPath, result, time = undefined) {
  const warning = result.luminance < LOW_LUMINANCE ? ' LOW_LUMINANCE' : '';
  const target = outputPath ? path.relative(process.cwd(), outputPath) : `capture ${time.toFixed(2)}s`;
  console.log(`${target} fidelity=${result.fidelity} state=${result.state} luminance=${result.luminance.toFixed(4)}${warning}`);
}

function defaultColumns(count) {
  return Math.ceil(Math.sqrt(count));
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function projectileSuffix(options) {
  return options.projectiles ? '-projectiles' : '';
}

function mortalitySuffix(options) {
  return options.immortal ? '' : '-mortal';
}

function startScreenSuffix(options) {
  return options.startScreen ? '-start-screen' : '';
}

function formatTime(seconds) {
  const rounded = Math.round(seconds * 100) / 100;
  return `${String(rounded).replace(/\./g, 'p')}s`;
}

function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'level';
}

function decodePngDataUrl(dataUrl) {
  const prefix = 'data:image/png;base64,';
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) throw new Error('Capture did not return a PNG data URL');
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
}

function addSnapshotSeedTextChunk(png, seed) {
  if (seed === undefined || seed === null) return png;
  return addPngTextChunk(png, 'raild.snapshot.seed', String(seed));
}

function addPngTextChunk(png, keyword, text) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < signature.length || !png.subarray(0, signature.length).equals(signature)) throw new Error('Capture did not return a valid PNG');
  const iendOffset = findPngChunkOffset(png, 'IEND');
  const chunk = createPngChunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1'));
  return Buffer.concat([png.subarray(0, iendOffset), chunk, png.subarray(iendOffset)]);
}

function findPngChunkOffset(png, targetType) {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === targetType) return offset;
    offset += 12 + length;
  }
  throw new Error(`PNG chunk not found: ${targetType}`);
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findChromeExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveMusicalTimes(options) {
  const metadata = options.metadata;
  const bpm = metadata.bpm;
  const duration = metadata.duration;
  const markers = metadata.markers || {};
  const sections = metadata.sections || [];

  options.musicalLabels = {};

  const beatsPerBar = 4;
  const beatSeconds = 60 / bpm;

  for (const rawVal of options.atsRaw) {
    let resolvedTime = null;
    let label = rawVal;

    const markerKey = Object.keys(markers).find((k) => k.toLowerCase() === rawVal.toLowerCase());
    if (markerKey !== undefined) {
      resolvedTime = markers[markerKey];
      label = markerKey;
    } else {
      const parts = rawVal.split(':');
      const barVal = Number(parts[0]);
      if (!Number.isNaN(barVal) && Number.isFinite(barVal)) {
        const beatVal = parts.length > 1 ? Number(parts[1]) : 0;
        if (!Number.isNaN(beatVal) && Number.isFinite(beatVal)) {
          resolvedTime = (barVal * beatsPerBar + beatVal) * beatSeconds;
          label = parts.length > 1 ? `bar-${barVal}-beat-${beatVal}` : `bar-${barVal}`;
        }
      }
    }

    if (resolvedTime === null) {
      throw new Error(`Could not resolve musical position '${rawVal}' for level '${options.level}'. It must be a valid bar[:beat] or marker name.`);
    }

    if (resolvedTime < 0 || resolvedTime > duration) {
      throw new Error(`Resolved musical position '${rawVal}' (${resolvedTime.toFixed(2)}s) is out of bounds (level duration is ${duration.toFixed(2)}s)`);
    }

    options.times.push(resolvedTime);
    options.musicalLabels[resolvedTime] = label;
  }

  if (options.sections) {
    for (const section of sections) {
      const resolvedTime = section.time;
      if (resolvedTime >= 0 && resolvedTime <= duration) {
        options.times.push(resolvedTime);
        options.musicalLabels[resolvedTime] = `section-${section.name}`;
      }
    }
  }

  const seen = new Set();
  const sortedUnique = [];
  const newMusicalLabels = {};

  for (const t of options.times) {
    const rounded = Math.round(t * 10000) / 10000;
    if (!seen.has(rounded)) {
      seen.add(rounded);
      sortedUnique.push(t);
      if (options.musicalLabels[t]) {
        newMusicalLabels[t] = options.musicalLabels[t];
      }
    } else {
      const existingTime = sortedUnique.find((x) => Math.abs(x - t) < 0.0001);
      if (existingTime !== undefined && options.musicalLabels[t]) {
        newMusicalLabels[existingTime] = options.musicalLabels[t];
      }
    }
  }

  sortedUnique.sort((a, b) => a - b);
  options.times = sortedUnique;
  options.musicalLabels = newMusicalLabels;
}
