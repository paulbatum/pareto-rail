#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { openRenderBrowser } from './capture/render-browser.mjs';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DT = 1 / 60;
const DEFAULT_SAMPLE_STEP = 0.1;
// A target warns when it is blocked for at least DEFAULT_MIN_OCCLUDED_SECONDS. The
// ratio is an opt-in extra filter, so its default admits any occluded target.
const DEFAULT_THRESHOLD = 0;
const DEFAULT_MIN_OCCLUDED_SECONDS = 2;
const DEFAULT_SEVERE_OCCLUDED_SECONDS = 8;
const DEFAULT_MIN_WARNING_TARGETS = 3;
const DEFAULT_WARNING_TARGET_RATIO = 0.05;
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

  if (reports.some((report) => report.failed) && options.fail) process.exitCode = 1;
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

  let target;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine Vite dev server port');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Occlusion is CPU raycasting against the scene graph and never renders a frame, so
    // it always takes the software path: a GPU browser would cost startup and change nothing.
    target = await openRenderBrowser({ mode: 'software' });

    const reports = [];
    for (const level of levels) reports.push(await analyzeLevel(target.browser, baseUrl, level, resolvedOptions));
    return reports;
  } finally {
    if (target) await target.close();
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
    const url = new URL('/dev-tools/gameplay-snapshot.html', baseUrl);
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
      severeOccludedSeconds: options.severeOccludedSeconds,
      minWarningTargets: options.minWarningTargets,
      warningTargetRatio: options.warningTargetRatio,
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
  const builtIns = [...arrayMatch[1].matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const benchmarks = [];
  const benchmarkRoot = path.resolve(root, 'src/benchmark-levels');
  try {
    for (const entry of await fs.readdir(benchmarkRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'test-fixtures') continue;
      try {
        const descriptor = JSON.parse(await fs.readFile(path.join(benchmarkRoot, entry.name, 'level.json'), 'utf8'));
        if (descriptor.id === entry.name) benchmarks.push(descriptor.id);
      } catch {
        // Catalog validation reports malformed benchmark directories separately.
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return [...builtIns, ...benchmarks.sort()];
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
    minOccludedSeconds: DEFAULT_MIN_OCCLUDED_SECONDS,
    severeOccludedSeconds: DEFAULT_SEVERE_OCCLUDED_SECONDS,
    minWarningTargets: DEFAULT_MIN_WARNING_TARGETS,
    warningTargetRatio: DEFAULT_WARNING_TARGET_RATIO,
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
      case 'severe-occluded-seconds':
      case 'severeOccludedSeconds':
        parsed.severeOccludedSeconds = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'min-warning-targets':
      case 'minWarningTargets':
        parsed.minWarningTargets = readPositiveInteger(value, `--${key}`);
        break;
      case 'warning-target-ratio':
      case 'warningTargetRatio':
        parsed.warningTargetRatio = readNonNegativeNumber(value, `--${key}`);
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
  const minOccludedSeconds = options.minOccludedSeconds ?? DEFAULT_MIN_OCCLUDED_SECONDS;
  const severeOccludedSeconds = options.severeOccludedSeconds ?? DEFAULT_SEVERE_OCCLUDED_SECONDS;
  lines.push(`Target occlusion check (warn at ${minOccludedSeconds.toFixed(1)}s occluded per target, fail at ${severeOccludedSeconds.toFixed(1)}s on one target or a warning spread across ${(options.warningTargetRatio ?? DEFAULT_WARNING_TARGET_RATIO) * 100}% of targets, sample ${options.sampleStep.toFixed(3)}s, policy ${options.policy})`);
  for (const report of reports) {
    const worst = [...report.targets].sort((a, b) => b.occludedSeconds - a.occludedSeconds)[0];
    const warningLabel = report.warnings.length === 0 ? 'ok' : `${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}`;
    const worstLabel = worst ? `, worst ${labelTarget(worst)} ${worst.occludedSeconds.toFixed(1)}s (${(worst.occludedRatio * 100).toFixed(1)}%)` : '';
    const glyph = report.failed ? '✗' : report.warnings.length === 0 ? '✓' : '⚠';
    lines.push('');
    lines.push(`${glyph} ${report.level.title}: ${warningLabel} across ${report.targets.length} targets${worstLabel}`);
    if (report.failureReason) lines.push(`  FAIL: ${report.failureReason}`);
    for (const warning of report.warnings.slice(0, options.json ? report.warnings.length : 12)) {
      const first = warning.firstOccludedAt === null ? 'unknown' : `${warning.firstOccludedAt.toFixed(1)}s`;
      lines.push(`  #${warning.enemyId} ${labelTarget(warning)}: ${warning.occludedSeconds.toFixed(1)}s occluded of ${warning.onscreenSeconds.toFixed(1)}s on-screen (${(warning.occludedRatio * 100).toFixed(1)}%), first ${first}, occluder ${warning.worstOccluder ?? 'unknown'}`);
    }
    if (report.warnings.length > 12) lines.push(`  … ${report.warnings.length - 12} more warnings`);
  }
  const warned = reports.filter((report) => report.warnings.length > 0).length;
  const failed = reports.filter((report) => report.failed).length;
  lines.push('');
  lines.push(`${reports.length} level${reports.length === 1 ? '' : 's'} checked, ${warned} with warnings, ${failed} failing.`);
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


function pathToFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function printHelpAndExit() {
  console.log(`Usage: npm run check:occlusion -- [--all | --level <id> | --levels a,b]\n\nOptions:\n  --min-occluded-seconds <seconds> Per-target warning floor, default ${DEFAULT_MIN_OCCLUDED_SECONDS}\n  --severe-occluded-seconds <sec>  One target this occluded fails the level, default ${DEFAULT_SEVERE_OCCLUDED_SECONDS}\n  --min-warning-targets <count>    Warning targets needed to fail a level, default ${DEFAULT_MIN_WARNING_TARGETS}\n  --warning-target-ratio <ratio>   Fraction of targets that must warn to fail, default ${DEFAULT_WARNING_TARGET_RATIO}\n  --threshold <ratio>              Extra occluded-ratio filter, default ${DEFAULT_THRESHOLD}\n  --sample-step <seconds>          Occlusion sample interval, default ${DEFAULT_SAMPLE_STEP}\n  --dt <seconds>                   Runtime simulation step, default ${DEFAULT_DT}\n  --min-onscreen-samples <count>   Ignore very brief on-screen targets, default 3\n  --include-targets-as-occluders   Count other targets as occluding geometry\n  --policy <perfect|none>          Drive the run, default perfect\n  --json                           Print JSON reports\n  --no-fail                        Exit zero even when a level fails`);
  process.exit(0);
}
