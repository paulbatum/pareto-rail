#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TRACE_TARGETS = {
  'crystal-debug': {
    module: '/src/levels/crystal-debug/audio.ts',
    exportName: 'traceCrystalDebugAudio',
  },
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await captureTrace(options);

  if (options.write) {
    const outPath = path.resolve(root, options.write);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
  }

  if (options.compare) {
    await compareTrace(result, options.compare);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.verbose) {
    console.log(formatVerbose(result));
  } else if (!options.write || options.compare) {
    console.log(formatSummary(result));
  }
}

async function captureTrace(options) {
  const target = TRACE_TARGETS[options.level];
  if (!target) throw new Error(`Unsupported audio trace level: ${options.level}`);

  const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
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
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[page] ${message.text()}`);
    });
    page.on('pageerror', (error) => console.error(`[page] ${error.message}`));

    await page.goto(new URL('/audio-trace.html', baseUrl).href, { waitUntil: 'networkidle0' });
    return await page.evaluate(
      async ({ modulePath, exportName, seconds }) => {
        const mod = await import(modulePath);
        const trace = mod[exportName];
        if (typeof trace !== 'function') throw new Error(`Missing trace export: ${exportName}`);
        return trace({ seconds });
      },
      { modulePath: target.module, exportName: target.exportName, seconds: options.seconds },
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

function formatSummary(result) {
  const { metadata, events } = result;
  const counts = countBy(events, (event) => event.kind);
  const sortedKinds = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const lines = [];
  lines.push(`${metadata.level} audio trace summary`);
  lines.push(`Duration: ${formatSeconds(metadata.seconds)} · Tempo: ${metadata.bpm ?? 'unknown'} BPM · Grid: ${metadata.stepSeconds ? `${metadata.stepSeconds.toFixed(3)}s` : 'unknown'}`);
  lines.push(`Events: ${events.length}${sortedKinds.length ? ` · ${sortedKinds.map((kind) => `${kind}=${counts[kind]}`).join(', ')}` : ''}`);

  if (metadata.bpm) {
    const barSeconds = 4 * (60 / metadata.bpm);
    const sectionBars = 8;
    const sectionSeconds = barSeconds * sectionBars;
    lines.push('Sections:');
    for (let start = 0; start < metadata.seconds; start += sectionSeconds) {
      const end = Math.min(metadata.seconds, start + sectionSeconds);
      const sectionEvents = events.filter((event) => event.time >= start && event.time < end);
      const sectionCounts = countBy(sectionEvents, (event) => event.kind);
      const musicKinds = ['kick', 'clap', 'hat', 'bass', 'arp', 'pad', 'riser', 'beat'];
      const summary = musicKinds.filter((kind) => sectionCounts[kind]).map((kind) => `${kind}=${sectionCounts[kind]}`).join(', ');
      lines.push(`- ${formatSeconds(start)}–${formatSeconds(end)}: ${summary || 'no traced events'}`);
    }
  }

  const firsts = [];
  for (const kind of sortedKinds) {
    const first = events.find((event) => event.kind === kind);
    if (first) firsts.push(`${kind}@${formatSeconds(first.time)}`);
  }
  if (firsts.length) lines.push(`First appearances: ${firsts.join(', ')}`);
  return lines.join('\n');
}

function formatVerbose(result) {
  return result.events.map(formatEventLine).join('\n');
}

function formatEventLine(event) {
  const data = event.data ?? {};
  const fields = Object.keys(data)
    .sort()
    .map((key) => `${key}=${formatValue(data[key])}`);
  return `${event.time.toFixed(3).padStart(8, '0')} ${event.kind}${fields.length ? ` ${fields.join(' ')}` : ''}`;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

async function compareTrace(result, comparePath) {
  const expectedPath = path.resolve(root, comparePath);
  const expected = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
  const expectedLines = formatVerbose(expected).split('\n');
  const actualLines = formatVerbose(result).split('\n');
  if (expectedLines.join('\n') === actualLines.join('\n')) {
    console.log(`trace matches ${path.relative(process.cwd(), expectedPath)}`);
    return;
  }

  const max = Math.max(expectedLines.length, actualLines.length);
  let firstDiff = 0;
  while (firstDiff < max && expectedLines[firstDiff] === actualLines[firstDiff]) firstDiff += 1;
  const start = Math.max(0, firstDiff - 4);
  const end = Math.min(max, firstDiff + 8);
  console.error(`trace differs from ${path.relative(process.cwd(), expectedPath)} at line ${firstDiff + 1}`);
  for (let i = start; i < end; i += 1) {
    const expectedLine = expectedLines[i] ?? '<missing>';
    const actualLine = actualLines[i] ?? '<missing>';
    if (expectedLine === actualLine) console.error(`  ${String(i + 1).padStart(5)} ${expectedLine}`);
    else {
      console.error(`- ${String(i + 1).padStart(5)} ${expectedLine}`);
      console.error(`+ ${String(i + 1).padStart(5)} ${actualLine}`);
    }
  }
  process.exitCode = 1;
}

function countBy(values, keyForValue) {
  const counts = {};
  for (const value of values) {
    const key = keyForValue(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const options = {
    level: 'crystal-debug',
    seconds: 45,
    verbose: false,
    json: false,
    compare: undefined,
    write: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);

    switch (key) {
      case 'level':
        options.level = readValue(argv, ++i, '--level');
        break;
      case 'seconds':
        options.seconds = readPositiveNumber(readValue(argv, ++i, '--seconds'), '--seconds');
        break;
      case 'compare':
        options.compare = readValue(argv, ++i, '--compare');
        break;
      case 'write':
        options.write = readValue(argv, ++i, '--write');
        break;
      case 'verbose':
        options.verbose = true;
        break;
      case 'json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return options;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function readPositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number`);
  return parsed;
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(1)}s`;
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
