#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const DEFAULT_SIZE = 800;
const DEFAULT_ANGLES = 4;
const DEFAULT_OUT = 'snapshots';
const DEFAULT_BLOOM = '1';
const DEFAULT_PITCH = -12;
const BLACK_LUMINANCE = 0.01;

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

    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[page] ${message.text()}`);
    });
    page.on('pageerror', (error) => console.error(`[page] ${error.message}`));
    await page.setViewport({ width: options.size, height: options.size, deviceScaleFactor: 1 });

    const url = new URL('/snapshot.html', baseUrl);
    url.searchParams.set('module', options.module);
    url.searchParams.set('export', options.exportName);
    url.searchParams.set('size', String(options.size));
    url.searchParams.set('bloom', options.bloom);
    if (options.args !== undefined) url.searchParams.set('args', options.args);

    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => window.__snapshot.ready);

    let sawBlackFrame = false;
    for (const yaw of makeYaws(options.angles)) {
      const dataUrl = await page.evaluate(
        ({ captureYaw, pitch }) => window.__snapshot.capture(captureYaw, pitch),
        { captureYaw: yaw, pitch: DEFAULT_PITCH },
      );
      const luminance = await page.evaluate(() => window.__snapshot.luminance());
      const outputPath = path.join(outDir, `${options.exportName}-${formatYaw(yaw)}.png`);
      await fs.writeFile(outputPath, decodePngDataUrl(dataUrl));
      console.log(`${path.relative(process.cwd(), outputPath)} luminance=${luminance.toFixed(4)}`);
      if (luminance < BLACK_LUMINANCE) sawBlackFrame = true;
    }

    if (sawBlackFrame) throw new Error(`Snapshot luminance was below ${BLACK_LUMINANCE}`);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

function parseArgs(argv) {
  const parsed = {
    module: undefined,
    exportName: undefined,
    args: undefined,
    out: DEFAULT_OUT,
    angles: DEFAULT_ANGLES,
    size: DEFAULT_SIZE,
    bloom: DEFAULT_BLOOM,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i += 1;

    switch (key) {
      case 'module':
        parsed.module = value;
        break;
      case 'export':
        parsed.exportName = value;
        break;
      case 'args':
        JSON.parse(value);
        parsed.args = value;
        break;
      case 'out':
        parsed.out = value;
        break;
      case 'angles':
        parsed.angles = readPositiveInteger(value, '--angles');
        break;
      case 'size':
        parsed.size = readPositiveInteger(value, '--size');
        break;
      case 'bloom':
        if (value !== '0' && value !== '1') throw new Error('--bloom must be 0 or 1');
        parsed.bloom = value;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.module) throw new Error('Missing required option: --module <path>');
  if (!parsed.exportName) throw new Error('Missing required option: --export <name>');
  return parsed;
}

function readPositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function makeYaws(count) {
  return Array.from({ length: count }, (_, index) => (index * 360) / count);
}

function formatYaw(yaw) {
  return String(Math.round(yaw)).padStart(3, '0');
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
