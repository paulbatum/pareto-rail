#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 360;
const DEFAULT_DT = 1 / 60;
const DEFAULT_SEED = 20260704;
const DEFAULT_GROWTH_RATIO = 1.35;
const DEFAULT_HEAP_ALLOWANCE_MB = 32;
const DEFAULT_HEAP_SLOPE_MB_PER_SECOND = 0.35;
const DEFAULT_MAX_CALLS = 500;
const DEFAULT_MAX_OBJECTS = 5000;
const DEFAULT_FRAME_GROWTH_WARN_RATIO = 1.5;
const DEFAULT_DRAW_CALL_GROWTH_ALLOWANCE = 64;
const DEFAULT_OBJECT_GROWTH_ALLOWANCE = 128;
const DEFAULT_GEOMETRY_GROWTH_ALLOWANCE = 512;
const DEFAULT_TEXTURE_GROWTH_ALLOWANCE = 8;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && import.meta.url === pathToFileUrl(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const levels = options.levels.length > 0 ? options.levels : [options.level].filter(Boolean);
  if (levels.length === 0) throw new Error('Missing --level <id>');

  const reports = await analyzePerformanceLevels(levels, options);
  if (options.jsonPath) {
    const outPath = path.resolve(process.cwd(), options.jsonPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  }
  console.log(formatPerformanceReports(reports, options));

  const failureCount = reports.reduce((sum, report) => sum + report.failures.length, 0);
  if (failureCount > 0 && options.fail) process.exitCode = 1;
}

export async function analyzePerformanceLevels(levels, options = {}) {
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

  let client;
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
    url.searchParams.set('projectiles', '1');
    url.searchParams.set('seed', String(options.seed));
    url.searchParams.set('render', options.render);
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => window.__gameplaySnapshot.ready);

    client = await page.createCDPSession();
    await client.send('Performance.enable');

    const metadata = await page.evaluate(() => window.__gameplaySnapshot.metadata());
    if (!metadata || !Number.isFinite(metadata.duration) || metadata.duration <= 0) {
      throw new Error(`Could not read level duration for ${level}`);
    }

    const samples = [];
    const duration = metadata.duration;
    const sampleTargets = makeSampleTargets(duration);
    for (const targetTime of sampleTargets) {
      const sample = await page.evaluate(
        (stepOptions) => window.__gameplaySnapshot.stepPerformance(stepOptions),
        { targetTime, dt: options.dt },
      );
      const heapUsedMB = await readCdpHeapUsedMB(client);
      samples.push({ ...sample, heapUsedMB: heapUsedMB ?? sample.heapUsedMB });
    }

    return analyzeSamples({
      level: { id: level, title: metadata.title ?? level, duration },
      samples,
      options,
    });
  } finally {
    if (client) await client.detach().catch(() => {});
    await page.close();
  }
}

function makeSampleTargets(duration) {
  const targets = [];
  const lastWhole = Math.floor(duration);
  for (let t = 1; t <= lastWhole; t += 1) targets.push(t);
  if (duration - lastWhole > 0.001) targets.push(duration);
  return targets;
}

async function readCdpHeapUsedMB(client) {
  const result = await client.send('Performance.getMetrics');
  const metric = result.metrics.find((item) => item.name === 'JSHeapUsedSize');
  if (!metric || !Number.isFinite(metric.value)) return null;
  return round(metric.value / (1024 * 1024), 3);
}

function analyzeSamples({ level, samples, options }) {
  const early = selectEarlyWindow(samples);
  const late = selectLateWindow(samples);
  const gates = [];
  const warnings = [];

  addGrowthGate(gates, 'draw calls growth', samples, early, late, 'calls', options.growthRatio, { allowance: options.drawCallGrowthAllowance });
  addGrowthGate(gates, 'scene objects growth', samples, early, late, 'sceneObjects', options.growthRatio, { allowance: options.objectGrowthAllowance });
  addGrowthGate(gates, 'visible objects growth', samples, early, late, 'visibleObjects', options.growthRatio, { allowance: options.objectGrowthAllowance });
  addGrowthGate(gates, 'geometry count growth', samples, early, late, 'geometries', options.growthRatio, { allowance: options.geometryGrowthAllowance });
  addGrowthGate(gates, 'texture count growth', samples, early, late, 'textures', options.growthRatio, { zeroIsOk: true, allowance: options.textureGrowthAllowance });
  addHeapGrowthGate(gates, samples, early, late, options);
  addHeapSlopeGate(gates, samples, options);
  addBudgetGate(gates, samples, 'draw call budget', 'calls', options.maxCalls);
  addBudgetGate(gates, samples, 'scene object budget', 'sceneObjects', options.maxObjects);
  addFrameGrowthWarning(warnings, early, late, options.frameGrowthWarnRatio);

  const failures = gates.filter((gate) => gate.status === 'fail');
  return { level, options: publicOptions(options), samples, windows: describeWindows(early, late), gates, warnings, failures };
}

function selectEarlyWindow(samples) {
  let selected = samples.filter((sample) => sample.t >= 2 && sample.t <= 5);
  if (selected.length > 0) return selected;
  selected = samples.slice(0, Math.min(samples.length, 4));
  return selected;
}

function selectLateWindow(samples) {
  if (samples.length === 0) return [];
  const duration = samples[samples.length - 1].t;
  const start = duration * 0.75;
  const selected = samples.filter((sample) => sample.t >= start);
  return selected.length > 0 ? selected : samples.slice(-Math.min(samples.length, 4));
}

function addGrowthGate(gates, name, samples, early, late, key, threshold, extra = {}) {
  const earlyMean = mean(early.map((sample) => sample[key]));
  const lateMean = mean(late.map((sample) => sample[key]));
  const ratio = safeRatio(lateMean, earlyMean);
  const growth = lateMean - earlyMean;
  const allowance = extra.allowance ?? 0;
  const failed = extra.zeroIsOk && earlyMean === 0
    ? lateMean > allowance
    : ratio > threshold && growth > allowance;
  gates.push({
    name,
    status: failed ? 'fail' : 'pass',
    metric: key,
    early: round(earlyMean, 3),
    late: round(lateMean, 3),
    ratio: round(ratio, 3),
    threshold,
    allowance,
    detail: `${formatNumber(lateMean)} late vs ${formatNumber(earlyMean)} early (${formatRatio(ratio)}, +${formatNumber(growth)}, allowance ${formatNumber(allowance)})`,
  });
}

function addHeapGrowthGate(gates, samples, early, late, options) {
  const earlyHeap = mean(early.map((sample) => sample.heapUsedMB).filter(isFiniteNumber));
  const lateHeap = mean(late.map((sample) => sample.heapUsedMB).filter(isFiniteNumber));
  if (!Number.isFinite(earlyHeap) || !Number.isFinite(lateHeap)) {
    gates.push({ name: 'heap growth', status: 'skip', metric: 'heapUsedMB', detail: 'heap metric unavailable' });
    return;
  }
  const ratio = safeRatio(lateHeap, earlyHeap);
  const growth = lateHeap - earlyHeap;
  const failed = ratio > options.growthRatio && growth > options.heapAllowanceMB;
  gates.push({
    name: 'heap growth',
    status: failed ? 'fail' : 'pass',
    metric: 'heapUsedMB',
    early: round(earlyHeap, 3),
    late: round(lateHeap, 3),
    ratio: round(ratio, 3),
    threshold: options.growthRatio,
    allowanceMB: options.heapAllowanceMB,
    detail: `${formatMB(lateHeap)} late vs ${formatMB(earlyHeap)} early (${formatRatio(ratio)}, +${formatMB(growth)})`,
  });
}

function addHeapSlopeGate(gates, samples, options) {
  const points = samples.filter((sample) => isFiniteNumber(sample.heapUsedMB));
  if (points.length < 4) {
    gates.push({ name: 'heap monotonic slope', status: 'skip', metric: 'heapUsedMB', detail: 'not enough heap samples' });
    return;
  }
  const slope = linearSlope(points.map((sample) => [sample.t, sample.heapUsedMB]));
  const first = points[0].heapUsedMB;
  const last = points[points.length - 1].heapUsedMB;
  const netGrowth = last - first;
  const nonDecreasingRatio = monotonicRatio(points.map((sample) => sample.heapUsedMB));
  const failed = slope > options.heapSlopeMBPerSecond && netGrowth > options.heapAllowanceMB && nonDecreasingRatio >= 0.7;
  gates.push({
    name: 'heap monotonic slope',
    status: failed ? 'fail' : 'pass',
    metric: 'heapUsedMB',
    slopeMBPerSecond: round(slope, 4),
    threshold: options.heapSlopeMBPerSecond,
    netGrowthMB: round(netGrowth, 3),
    allowanceMB: options.heapAllowanceMB,
    nonDecreasingRatio: round(nonDecreasingRatio, 3),
    detail: `${formatMB(netGrowth)} net, ${formatMB(slope)}/s slope, ${(nonDecreasingRatio * 100).toFixed(0)}% non-decreasing steps`,
  });
}

function addBudgetGate(gates, samples, name, key, limit) {
  const peak = Math.max(...samples.map((sample) => sample[key]));
  const failed = peak > limit;
  gates.push({
    name,
    status: failed ? 'fail' : 'pass',
    metric: key,
    peak,
    limit,
    detail: `${formatNumber(peak)} peak, limit ${formatNumber(limit)}`,
  });
}

function addFrameGrowthWarning(warnings, early, late, threshold) {
  const earlyMean = mean(early.map((sample) => sample.avgFrameMs));
  const lateMean = mean(late.map((sample) => sample.avgFrameMs));
  const ratio = safeRatio(lateMean, earlyMean);
  if (ratio > threshold) {
    warnings.push({
      name: 'relative frame-time growth',
      metric: 'avgFrameMs',
      early: round(earlyMean, 3),
      late: round(lateMean, 3),
      ratio: round(ratio, 3),
      threshold,
      detail: `${formatMs(lateMean)} late vs ${formatMs(earlyMean)} early (${formatRatio(ratio)})`,
    });
  }
}

export function formatPerformanceReports(reports, options = {}) {
  const lines = [];
  const resolvedOptions = { ...defaultOptions(), ...options };
  lines.push(`Performance check (growth ${resolvedOptions.growthRatio}×, max calls ${resolvedOptions.maxCalls}, max objects ${resolvedOptions.maxObjects})`);
  for (const report of reports) {
    const status = report.failures.length === 0 ? '✓' : '✗';
    lines.push('');
    lines.push(`${status} ${report.level.id}: duration ${report.level.duration.toFixed(1)}s, samples ${report.samples.length}`);
    lines.push(formatSampleTable(report.samples));
    lines.push('Gates:');
    for (const gate of report.gates) lines.push(`  ${gate.status === 'pass' ? '✓' : gate.status === 'skip' ? '-' : '✗'} ${gate.name}: ${gate.detail}`);
    if (report.warnings.length > 0) {
      lines.push('Warnings:');
      for (const warning of report.warnings) lines.push(`  ⚠ ${warning.name}: ${warning.detail}`);
    }
  }
  return lines.join('\n');
}

function formatSampleTable(samples) {
  const shown = compactSamples(samples);
  const rows = shown.map((sample) => [
    sample.t.toFixed(sample.t % 1 === 0 ? 0 : 1).padStart(5),
    String(sample.calls).padStart(5),
    compactInt(sample.triangles).padStart(7),
    String(sample.sceneObjects).padStart(7),
    String(sample.visibleObjects).padStart(7),
    String(sample.geometries).padStart(5),
    sample.heapUsedMB === null ? '   n/a' : sample.heapUsedMB.toFixed(1).padStart(6),
    sample.avgFrameMs.toFixed(2).padStart(8),
  ]);
  const lines = ['      t calls    tris objects visible geoms   heap ms/frame'];
  for (const row of rows) lines.push(row.join(' '));
  if (shown.length < samples.length) lines.push(`      … ${samples.length - shown.length} intermediate samples omitted`);
  return lines.join('\n');
}

function compactSamples(samples) {
  if (samples.length <= 18) return samples;
  return [...samples.slice(0, 6), ...samples.slice(Math.max(6, Math.floor(samples.length / 2) - 3), Math.floor(samples.length / 2) + 3), ...samples.slice(-6)];
}

function describeWindows(early, late) {
  const label = (windowSamples) => windowSamples.length === 0
    ? null
    : { start: windowSamples[0].t, end: windowSamples[windowSamples.length - 1].t, samples: windowSamples.length };
  return { early: label(early), late: label(late) };
}

function defaultOptions() {
  return {
    level: '',
    levels: [],
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    dt: DEFAULT_DT,
    seed: DEFAULT_SEED,
    growthRatio: DEFAULT_GROWTH_RATIO,
    heapAllowanceMB: DEFAULT_HEAP_ALLOWANCE_MB,
    heapSlopeMBPerSecond: DEFAULT_HEAP_SLOPE_MB_PER_SECOND,
    maxCalls: DEFAULT_MAX_CALLS,
    maxObjects: DEFAULT_MAX_OBJECTS,
    frameGrowthWarnRatio: DEFAULT_FRAME_GROWTH_WARN_RATIO,
    drawCallGrowthAllowance: DEFAULT_DRAW_CALL_GROWTH_ALLOWANCE,
    objectGrowthAllowance: DEFAULT_OBJECT_GROWTH_ALLOWANCE,
    geometryGrowthAllowance: DEFAULT_GEOMETRY_GROWTH_ALLOWANCE,
    textureGrowthAllowance: DEFAULT_TEXTURE_GROWTH_ALLOWANCE,
    jsonPath: '',
    fail: true,
    render: 'sample',
  };
}

function parseArgs(argv) {
  const parsed = defaultOptions();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'no-fail') {
      parsed.fail = false;
      continue;
    }
    if (key === 'help' || key === 'h') printHelpAndExit();

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i += 1;
    switch (key) {
      case 'level':
        parsed.level = value;
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
      case 'seed':
        parsed.seed = readInteger(value, '--seed');
        break;
      case 'growth-ratio':
      case 'growthRatio':
        parsed.growthRatio = readPositiveNumber(value, `--${key}`);
        break;
      case 'heap-allowance-mb':
      case 'heapAllowanceMB':
        parsed.heapAllowanceMB = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'heap-slope-mb-per-second':
      case 'heapSlopeMBPerSecond':
        parsed.heapSlopeMBPerSecond = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'max-calls':
      case 'maxCalls':
        parsed.maxCalls = readPositiveInteger(value, `--${key}`);
        break;
      case 'max-objects':
      case 'maxObjects':
        parsed.maxObjects = readPositiveInteger(value, `--${key}`);
        break;
      case 'frame-growth-warn-ratio':
      case 'frameGrowthWarnRatio':
        parsed.frameGrowthWarnRatio = readPositiveNumber(value, `--${key}`);
        break;
      case 'draw-call-growth-allowance':
      case 'drawCallGrowthAllowance':
        parsed.drawCallGrowthAllowance = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'object-growth-allowance':
      case 'objectGrowthAllowance':
        parsed.objectGrowthAllowance = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'geometry-growth-allowance':
      case 'geometryGrowthAllowance':
        parsed.geometryGrowthAllowance = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'texture-growth-allowance':
      case 'textureGrowthAllowance':
        parsed.textureGrowthAllowance = readNonNegativeNumber(value, `--${key}`);
        break;
      case 'json':
        parsed.jsonPath = value;
        break;
      case 'render':
        if (value !== 'all' && value !== 'sample') throw new Error('--render must be "all" or "sample"');
        parsed.render = value;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }
  return parsed;
}

function publicOptions(options) {
  return {
    dt: options.dt,
    seed: options.seed,
    growthRatio: options.growthRatio,
    heapAllowanceMB: options.heapAllowanceMB,
    heapSlopeMBPerSecond: options.heapSlopeMBPerSecond,
    maxCalls: options.maxCalls,
    maxObjects: options.maxObjects,
    frameGrowthWarnRatio: options.frameGrowthWarnRatio,
    drawCallGrowthAllowance: options.drawCallGrowthAllowance,
    objectGrowthAllowance: options.objectGrowthAllowance,
    geometryGrowthAllowance: options.geometryGrowthAllowance,
    textureGrowthAllowance: options.textureGrowthAllowance,
    render: options.render,
  };
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

function printHelpAndExit() {
  console.log(`Usage: npm run check:perf -- --level <id> [options]\n\nOptions:\n  --json <path>                         Write raw samples and gate verdicts\n  --render <all|sample>                 Render mode: "all" (every frame) or "sample" (only sample points), default "sample"\n  --growth-ratio <ratio>                Late/early growth failure ratio, default ${DEFAULT_GROWTH_RATIO}\n  --heap-allowance-mb <mb>              Absolute heap growth allowance, default ${DEFAULT_HEAP_ALLOWANCE_MB}\n  --heap-slope-mb-per-second <mb>       Monotonic heap slope allowance, default ${DEFAULT_HEAP_SLOPE_MB_PER_SECOND}\n  --max-calls <count>                   Absolute draw-call budget, default ${DEFAULT_MAX_CALLS}\n  --max-objects <count>                 Absolute scene object budget, default ${DEFAULT_MAX_OBJECTS}\n  --frame-growth-warn-ratio <ratio>     Relative frame-time warning ratio, default ${DEFAULT_FRAME_GROWTH_WARN_RATIO}\n  --draw-call-growth-allowance <count>  Absolute draw-call growth allowance, default ${DEFAULT_DRAW_CALL_GROWTH_ALLOWANCE}\n  --object-growth-allowance <count>     Absolute object growth allowance, default ${DEFAULT_OBJECT_GROWTH_ALLOWANCE}\n  --geometry-growth-allowance <count>   Absolute geometry growth allowance, default ${DEFAULT_GEOMETRY_GROWTH_ALLOWANCE}\n  --texture-growth-allowance <count>    Absolute texture growth allowance, default ${DEFAULT_TEXTURE_GROWTH_ALLOWANCE}\n  --dt <seconds>                        Fixed simulation step, default ${DEFAULT_DT}\n  --seed <integer>                      Snapshot RNG seed, default ${DEFAULT_SEED}\n  --no-fail                             Print failures but exit zero`);
  process.exit(0);
}

function mean(values) {
  const filtered = values.filter(isFiniteNumber);
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function safeRatio(numerator, denominator) {
  if (denominator === 0) return numerator === 0 ? 1 : Infinity;
  return numerator / denominator;
}

function linearSlope(points) {
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point[0], 0) / n;
  const meanY = points.reduce((sum, point) => sum + point[1], 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of points) {
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function monotonicRatio(values) {
  if (values.length < 2) return 1;
  let nonDecreasing = 0;
  for (let i = 1; i < values.length; i += 1) if (values[i] >= values[i - 1]) nonDecreasing += 1;
  return nonDecreasing / (values.length - 1);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return value >= 1000 ? Math.round(value).toLocaleString('en-US') : round(value, 2).toString();
}

function formatRatio(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}×` : '∞×';
}

function formatMB(value) {
  return `${round(value, 1).toFixed(1)} MB`;
}

function formatMs(value) {
  return `${round(value, 2).toFixed(2)} ms`;
}

function compactInt(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
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
