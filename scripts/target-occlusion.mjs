#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DT = 1 / 60;
const DEFAULT_SAMPLE_STEP = 0.1;
const DEFAULT_THRESHOLD = 0.05;
const DEFAULT_SEED = 20260704;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && import.meta.url === pathToFileUrl(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const levels = options.levels.length > 0 ? options.levels : await readLevelIds();
  if (levels.length === 0) throw new Error('No levels found');

  const reports = await analyzeOcclusionLevels(levels, options);

  if (options.json) console.log(JSON.stringify(reports, null, 2));
  else console.log(formatReports(reports, options));

  const warningCount = reports.reduce((sum, report) => sum + report.warnings.length, 0);
  if (warningCount > 0 && options.fail) process.exitCode = 1;
}

export async function analyzeOcclusionLevels(levels, options = {}) {
  const resolvedOptions = { ...defaultOptions(), ...options };
  const server = await createServer({
    root,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      hmr: false,
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

    const reports = [];
    for (const level of levels) reports.push(await analyzeLevel(browser, baseUrl, level, resolvedOptions));
    return reports;
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

async function analyzeLevel(browser, baseUrl, level, options) {
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[${level}] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.error(`[${level}] ${error.message}`));

  try {
    await page.setViewport({ width: options.width, height: options.height, deviceScaleFactor: 1 });
    const url = new URL('/gameplay-snapshot.html', baseUrl);
    url.searchParams.set('level', level);
    url.searchParams.set('time', '0');
    url.searchParams.set('dt', String(options.dt));
    url.searchParams.set('width', String(options.width));
    url.searchParams.set('height', String(options.height));
    url.searchParams.set('fidelity', 'postless');
    url.searchParams.set('immortal', '1');
    url.searchParams.set('seed', String(options.seed));
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => window.__gameplaySnapshot.ready);
    return await page.evaluate((analysisOptions) => window.__gameplaySnapshot.analyzeOcclusion(analysisOptions), {
      dt: options.dt,
      sampleStep: options.sampleStep,
      threshold: options.threshold,
      minOnscreenSamples: options.minOnscreenSamples,
      minOccludedSeconds: options.minOccludedSeconds,
      includeTargetsAsOccluders: options.includeTargetsAsOccluders,
      policy: options.policy,
    });
  } finally {
    await page.close();
  }
}

async function readLevelIds() {
  const registryPath = path.resolve(root, 'src/levels/index.ts');
  const source = await fs.readFile(registryPath, 'utf8');
  const arrayMatch = source.match(/export const levelMetadatas: LevelMetadata\[] = \[([\s\S]*?)\n\];/);
  if (!arrayMatch) throw new Error('Could not find levelMetadatas array in src/levels/index.ts');
  return [...arrayMatch[1].matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function defaultOptions() {
  return {
    levels: [],
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    dt: DEFAULT_DT,
    sampleStep: DEFAULT_SAMPLE_STEP,
    threshold: DEFAULT_THRESHOLD,
    minOnscreenSamples: 3,
    minOccludedSeconds: DEFAULT_SAMPLE_STEP,
    seed: DEFAULT_SEED,
    includeTargetsAsOccluders: false,
    policy: 'perfect',
    fail: true,
    json: false,
  };
}

function parseArgs(argv) {
  const parsed = defaultOptions();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);

    if (key === 'all') continue;
    if (key === 'json') {
      parsed.json = true;
      continue;
    }
    if (key === 'no-fail') {
      parsed.fail = false;
      continue;
    }
    if (key === 'include-targets-as-occluders') {
      parsed.includeTargetsAsOccluders = true;
      continue;
    }
    if (key === 'help' || key === 'h') printHelpAndExit();

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i += 1;

    switch (key) {
      case 'level':
        parsed.levels.push(value);
        break;
      case 'levels':
        parsed.levels.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
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
      case 'sample-step':
      case 'sampleStep':
        parsed.sampleStep = readPositiveNumber(value, `--${key}`);
        parsed.minOccludedSeconds = parsed.sampleStep;
        break;
      case 'threshold':
        parsed.threshold = readNonNegativeNumber(value, '--threshold');
        break;
      case 'min-onscreen-samples':
      case 'minOnscreenSamples':
        parsed.minOnscreenSamples = readPositiveInteger(value, `--${key}`);
        break;
      case 'min-occluded-seconds':
      case 'minOccludedSeconds':
        parsed.minOccludedSeconds = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'seed':
        parsed.seed = readInteger(value, '--seed');
        break;
      case 'policy':
        if (value !== 'none' && value !== 'perfect') throw new Error('--policy must be none or perfect');
        parsed.policy = value;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return parsed;
}

export function formatReports(reports, options) {
  const lines = [];
  lines.push(`Target occlusion check (threshold ${(options.threshold * 100).toFixed(1)}% of on-screen target lifetime, sample ${options.sampleStep.toFixed(3)}s, policy ${options.policy})`);
  for (const report of reports) {
    const worst = [...report.targets].sort((a, b) => b.occludedRatio - a.occludedRatio)[0];
    const warningLabel = report.warnings.length === 0 ? 'ok' : `${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}`;
    const worstLabel = worst ? `, worst ${labelTarget(worst)} ${(worst.occludedRatio * 100).toFixed(1)}%` : '';
    lines.push('');
    lines.push(`${report.warnings.length === 0 ? '✓' : '⚠'} ${report.level.title}: ${warningLabel} across ${report.targets.length} targets${worstLabel}`);
    for (const warning of report.warnings.slice(0, options.json ? report.warnings.length : 12)) {
      const first = warning.firstOccludedAt === null ? 'unknown' : `${warning.firstOccludedAt.toFixed(1)}s`;
      lines.push(`  #${warning.enemyId} ${labelTarget(warning)}: ${(warning.occludedRatio * 100).toFixed(1)}% occluded (${warning.occludedSeconds.toFixed(1)}s / ${warning.onscreenSeconds.toFixed(1)}s), first ${first}, occluder ${warning.worstOccluder ?? 'unknown'}`);
    }
    if (report.warnings.length > 12) lines.push(`  … ${report.warnings.length - 12} more warnings`);
  }
  return lines.join('\n');
}

function labelTarget(target) {
  return target.letter ? `${target.kind}:${target.letter}` : target.kind;
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
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be non-negative`);
  return parsed;
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

function pathToFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function printHelpAndExit() {
  console.log(`Usage: npm run check:occlusion -- [--all | --level <id> | --levels a,b]\n\nOptions:\n  --threshold <ratio>              Warning ratio, default ${DEFAULT_THRESHOLD}\n  --sample-step <seconds>          Occlusion sample interval, default ${DEFAULT_SAMPLE_STEP}\n  --dt <seconds>                   Runtime simulation step, default ${DEFAULT_DT}\n  --min-onscreen-samples <count>   Ignore very brief on-screen targets, default 3\n  --min-occluded-seconds <seconds> Ignore one-frame grazes, default sample-step\n  --include-targets-as-occluders   Count other targets as occluding geometry\n  --policy <perfect|none>          Drive the run, default perfect\n  --json                           Print JSON reports\n  --no-fail                        Exit zero even when warnings are found`);
  process.exit(0);
}
