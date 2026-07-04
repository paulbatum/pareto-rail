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

    for (const time of options.times) {
      const result = await captureWithFallbacks(browser, baseUrl, options, time);
      const outputPath = path.join(outDir, `${safeName(options.level)}-${formatTime(time)}-${result.fidelity}.png`);
      await fs.writeFile(outputPath, decodePngDataUrl(result.dataUrl));
      const warning = result.luminance < LOW_LUMINANCE ? ' LOW_LUMINANCE' : '';
      console.log(
        `${path.relative(process.cwd(), outputPath)} fidelity=${result.fidelity} state=${result.state} luminance=${result.luminance.toFixed(4)}${warning}`,
      );
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
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
    const url = new URL('/gameplay-snapshot.html', baseUrl);
    url.searchParams.set('level', options.level);
    url.searchParams.set('time', String(time));
    url.searchParams.set('dt', String(options.dt));
    url.searchParams.set('width', String(options.width));
    url.searchParams.set('height', String(options.height));
    url.searchParams.set('fidelity', fidelity);
    if (options.immortal) url.searchParams.set('immortal', '1');
    if (options.debugValue !== undefined) url.searchParams.set('debugValue', options.debugValue);

    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => window.__gameplaySnapshot.ready);
    const result = await page.evaluate(() => window.__gameplaySnapshot.capture());
    if (!result || typeof result.dataUrl !== 'string') throw new Error('Capture did not return a data URL');
    return result;
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
    immortal: false,
    debugValue: undefined,
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
        parsed.times.push(
          ...value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
            .map((part) => readNonNegativeNumber(part, '--times')),
        );
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
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.level) throw new Error('Missing required option: --level <id>');
  if (parsed.times.length === 0) throw new Error('Missing required option: --time <seconds> or --times <seconds,...>');
  return parsed;
}

function readPositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
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

function formatTime(seconds) {
  return `${String(seconds).replace(/\./g, 'p')}s`;
}

function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'level';
}

function decodePngDataUrl(dataUrl) {
  const prefix = 'data:image/png;base64,';
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) throw new Error('Capture did not return a PNG data URL');
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
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
