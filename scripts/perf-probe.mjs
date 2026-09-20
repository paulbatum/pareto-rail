#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { assertBackend, backendForMode, defaultRenderMode, gotoOrExplain, openRenderBrowser, readRenderMode } from './capture/render-browser.mjs';

/* Frame-time attribution for one level. At each requested time the probe steps the
   level to that time, then steps and renders `--frames` frames, timing the level update
   and the render call on the CPU and, on the WebGPU backend, the render passes and the
   compute dispatches on the GPU. The knobs (`--hide`, `--drop-stages`, `--no-velocity`)
   remove one cost at a time; run the probe once per knob and subtract. */

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DT = 1 / 60;
const DEFAULT_SEED = 20260704;
const DEFAULT_FRAMES = 24;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.level) throw new Error('Missing --level <id>');
  const report = await probeLevel(options);
  const gateFailures = gateGpuSamples(report.samples, options.maxGpuMs);
  if (options.jsonPath) {
    const outPath = path.resolve(process.cwd(), options.jsonPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  }
  console.log(formatReport(report));
  if (gateFailures.length > 0) throw new Error(`GPU budget failed:\n${gateFailures.map((failure) => `  ${failure}`).join('\n')}`);
}

export async function probeLevel(options) {
  const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  });
  let target;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine Vite dev server port');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    target = await openRenderBrowser({ mode: options.mode, width: options.width, height: options.height });
    return await probeInBrowser(target.browser, baseUrl, options);
  } finally {
    if (target) await target.close();
    await server.close();
  }
}

async function probeInBrowser(browser, baseUrl, options) {
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') console.error(`[${options.level}] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.error(`[${options.level}] ${error.message}`));
  try {
    await page.setViewport({ width: options.width, height: options.height, deviceScaleFactor: 1 });
    const url = new URL('/dev-tools/gameplay-snapshot.html', baseUrl);
    url.searchParams.set('level', options.level);
    url.searchParams.set('time', '0');
    url.searchParams.set('dt', String(options.dt));
    url.searchParams.set('width', String(options.width));
    url.searchParams.set('height', String(options.height));
    url.searchParams.set('fidelity', options.fidelity);
    url.searchParams.set('immortal', '1');
    url.searchParams.set('projectiles', '1');
    url.searchParams.set('seed', String(options.seed));
    url.searchParams.set('render', 'sample');
    url.searchParams.set('timestamps', '1');
    url.searchParams.set('backend', backendForMode(options.mode));
    if (options.startScreen) url.searchParams.set('startScreen', '1');
    if (options.hide.length > 0) url.searchParams.set('hide', options.hide.join(','));
    if (options.dropStages.length > 0) url.searchParams.set('dropStages', options.dropStages.join(','));
    if (options.velocityBuffer !== null) url.searchParams.set('velocityBuffer', options.velocityBuffer ? '1' : '0');
    await gotoOrExplain(page, url.href, { mode: options.mode, baseUrl });
    await page.evaluate(() => window.__gameplaySnapshot.ready);
    const metadata = await page.evaluate(() => window.__gameplaySnapshot.metadata());
    assertBackend(backendForMode(options.mode), metadata.backend);
    const times = requestedTimes(options, metadata);

    const samples = [];
    for (const time of times) {
      await page.evaluate((stepOptions) => window.__gameplaySnapshot.stepPerformance(stepOptions), { targetTime: time, dt: options.dt });
      for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
        const sample = await page.evaluate((probeOptions) => window.__gameplaySnapshot.probePerformance(probeOptions), {
          frames: options.frames,
          dt: options.dt,
          freeze: options.freeze,
          warmupFrames: options.warmupFrames,
          detail: options.detail,
        });
        samples.push({ ...sample, requestedTime: time, repeat, section: sectionAt(metadata, time) });
      }
    }
    return {
      level: { id: options.level, title: metadata.title ?? options.level, duration: metadata.duration },
      metadata: {
        adapter: metadata.adapter,
        renderSize: metadata.renderSize,
        timestampAvailable: metadata.timestampAvailable,
      },
      options: publicOptions(options, metadata.backend),
      samples,
    };
  } finally {
    await page.close();
  }
}

function sectionMidpoints(metadata) {
  const sections = metadata.sections ?? [];
  const duration = metadata.duration ?? 0;
  if (sections.length === 0) return [Math.max(1, duration / 2)];
  return sections.map((section, index) => {
    const end = index + 1 < sections.length ? sections[index + 1].time : duration;
    return Math.round(((section.time + end) / 2) * 10) / 10;
  });
}

function sectionAt(metadata, time) {
  const sections = metadata.sections ?? [];
  let name = '';
  for (const section of sections) if (time >= section.time) name = section.name;
  return name;
}

export function requestedTimes(options, metadata) {
  if (options.times.length > 0) return options.times;
  return options.startScreen ? [0.8] : sectionMidpoints(metadata);
}

export function formatReport(report) {
  const lines = [];
  const { options } = report;
  const knobs = [
    options.hide.length > 0 ? `hide ${options.hide.join(',')}` : '',
    options.dropStages.length > 0 ? `drop ${options.dropStages.join(',')}` : '',
    options.velocityBuffer === null ? '' : `velocityBuffer ${options.velocityBuffer ? 'on' : 'off'}`,
  ].filter(Boolean).join('; ');
  lines.push(`Perf probe: ${report.level.id} on ${options.backend}, ${options.width}x${options.height}, fidelity ${options.fidelity}, ${options.frames} frames per point${options.repeats > 1 ? `, ${options.repeats} repeats` : ''}${options.freeze ? ', frozen' : ''}${knobs ? ` (${knobs})` : ''}`);
  lines.push(' repeat requested section   t   update  render   first   gpu.render gpu.compute gpu.total gpu.p95 samples calls    tris');
  for (const sample of report.samples) {
    lines.push([
      String(sample.repeat).padStart(7),
      sample.requestedTime.toFixed(1).padStart(9),
      sample.section.padEnd(9),
      sample.t.toFixed(1).padStart(5),
      sample.updateMs.toFixed(2).padStart(7),
      sample.renderMs.toFixed(2).padStart(7),
      sample.firstRenderMs.toFixed(1).padStart(7),
      formatNullable(sample.gpuRenderMs).padStart(10),
      formatNullable(sample.gpuComputeMs).padStart(11),
      formatNullable(sample.gpuTotalMs).padStart(9),
      formatNullable(sample.gpuTotalP95Ms).padStart(7),
      String(sample.gpuSamples).padStart(7),
      String(sample.calls).padStart(5),
      compactInt(sample.triangles).padStart(7),
    ].join(' '));
  }
  lines.push('update and render are CPU milliseconds (median); GPU columns are milliseconds (median), total is render+compute per frame, and p95 is total GPU duration.');
  if (options.detail) {
    for (const sample of report.samples) {
      lines.push('');
      lines.push(`Frames from ${sample.section} (requested ${sample.requestedTime.toFixed(1)}s, repeat ${sample.repeat}), render ms with pipeline and builder cache sizes; a rise in either marks a compile:`);
      lines.push((sample.detail ?? []).map((frame) => `${frame.t.toFixed(2)}:${frame.renderMs.toFixed(1)}${frame.gpuRenderMs === null ? '' : `/${frame.gpuRenderMs.toFixed(1)}`}${frame.gpuTotalMs === null ? '' : `=${frame.gpuTotalMs.toFixed(1)}`} p${frame.pipelines ?? '?'} b${frame.builders ?? '?'}`).join('  '));
    }
  }
  return lines.join('\n');
}

function formatNullable(value) {
  return value === null || value === undefined ? 'n/a' : value.toFixed(2);
}

function compactInt(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function publicOptions(options, backend) {
  return {
    backend,
    width: options.width,
    height: options.height,
    fidelity: options.fidelity,
    frames: options.frames,
    warmupFrames: options.warmupFrames,
    repeats: options.repeats,
    freeze: options.freeze,
    startScreen: options.startScreen,
    dt: options.dt,
    seed: options.seed,
    times: options.times,
    hide: options.hide,
    dropStages: options.dropStages,
    velocityBuffer: options.velocityBuffer,
    detail: options.detail,
    maxGpuMs: options.maxGpuMs,
  };
}

function defaultOptions() {
  return {
    level: '',
    times: [],
    frames: DEFAULT_FRAMES,
    warmupFrames: 0,
    repeats: 1,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    dt: DEFAULT_DT,
    seed: DEFAULT_SEED,
    fidelity: 'full',
    mode: defaultRenderMode(),
    hide: [],
    dropStages: [],
    velocityBuffer: null,
    detail: false,
    freeze: false,
    startScreen: false,
    maxGpuMs: null,
    jsonPath: '',
  };
}
export function parseArgs(argv) {
  const parsed = defaultOptions();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    if (key === 'gpu') {
      parsed.mode = 'gpu';
      continue;
    }
    if (key === 'software') {
      parsed.mode = 'software';
      continue;
    }
    if (key === 'no-velocity') {
      parsed.velocityBuffer = false;
      continue;
    }
    if (key === 'detail') {
      parsed.detail = true;
      continue;
    }
    if (key === 'freeze') {
      parsed.freeze = true;
      continue;
    }
    if (key === 'start-screen') {
      parsed.startScreen = true;
      continue;
    }
    if (key === 'help' || key === 'h') printHelpAndExit();
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i += 1;
    switch (key) {
      case 'level':
        parsed.level = value;
        break;
      case 'times': {
        const items = value.split(',');
        if (items.length === 0 || items.some((item) => item.trim() === '')) throw new Error('--times must contain finite non-negative values');
        parsed.times = items.map((item) => {
          const time = Number(item.trim());
          if (!Number.isFinite(time) || time < 0) throw new Error('--times must contain finite non-negative values');
          return time;
        });
        for (let index = 1; index < parsed.times.length; index += 1) {
          if (parsed.times[index] < parsed.times[index - 1]) throw new Error('--times must be ordered');
        }
        break;
      }
      case 'frames':
        parsed.frames = readPositiveInteger(value, '--frames');
        break;
      case 'warmup':
        parsed.warmupFrames = readNonNegativeInteger(value, '--warmup');
        break;
      case 'repeats':
        parsed.repeats = readPositiveInteger(value, '--repeats');
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
      case 'max-gpu-ms':
        parsed.maxGpuMs = readPositiveNumber(value, '--max-gpu-ms');
        break;
      case 'fidelity':
        if (value !== 'postless' && value !== 'full') throw new Error('--fidelity must be "postless" or "full"');
        parsed.fidelity = value;
        break;
      case 'hide':
        parsed.hide = value.split(',').map((item) => item.trim()).filter(Boolean);
        break;
      case 'drop-stages':
        parsed.dropStages = value.split(',').map((item) => item.trim()).filter(Boolean);
        break;
      case 'render-mode':
        parsed.mode = readRenderMode(value);
        break;
      case 'json':
        parsed.jsonPath = value;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }
  if (!Number.isFinite(parsed.dt) || parsed.dt <= 0) throw new Error('--dt must be a positive number');
  if (!Number.isInteger(parsed.seed)) throw new Error('--seed must be an integer');
  if (parsed.maxGpuMs !== null && parsed.mode !== 'gpu') throw new Error('--max-gpu-ms requires --gpu; software timing is not a hardware budget');
  return parsed;
}
function readPositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number`);
  return parsed;
}

function readInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} must be an integer`);
  return parsed;
}

function readNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}

export function gateGpuSamples(samples, maxGpuMs) {
  if (maxGpuMs === null || maxGpuMs === undefined) return [];
  if (samples.length === 0) return ['no GPU samples were collected'];
  return samples.flatMap((sample, index) => {
    if (!Number.isFinite(sample.gpuTotalMs) || sample.gpuTotalMs < 0 || !Number.isInteger(sample.frames) || sample.frames <= 0 || sample.gpuSamples !== sample.frames) {
      return [`sample ${index + 1} (requested ${sample.requestedTime ?? sample.t ?? '?'}s repeat ${sample.repeat ?? 1}) has missing GPU timestamps`];
    }
    return sample.gpuTotalMs > maxGpuMs
      ? [`sample ${index + 1} (requested ${sample.requestedTime ?? sample.t ?? '?'}s repeat ${sample.repeat ?? 1}) total GPU median ${sample.gpuTotalMs.toFixed(2)}ms exceeds ${maxGpuMs.toFixed(2)}ms`]
      : [];
  });
}

function readPositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function printHelpAndExit() {
  console.log(`Usage: npm run perf:probe -- --level <id> [options]

Options:
  --times <list>              Comma-separated ordered run times; default midpoint of every section
  --start-screen              Probe attract mode; default time is 0.8s when --times is omitted
  --frames <count>            Frames stepped and rendered per time, default ${DEFAULT_FRAMES}
  --warmup <count>            Warmup frames discarded before measurement, default 0
  --repeats <count>           Repeats per requested point, default 1
  --freeze                    Keep runtime/camera/node time fixed while rendering
  --max-gpu-ms <positive>     Fail if any sample's median total GPU ms exceeds this budget
  --width <px> --height <px>  Render size, default ${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}
  --fidelity <full|postless>  Post chain on (default) or off
  --gpu | --software          Real WebGPU pipeline (default) or the SwiftShader fallback
  --hide <names>              Scene objects (by name) set invisible before probing
  --drop-stages <types>       Post stage types left out of the chain
  --no-velocity               Build the post chain without the velocity buffer
  --detail                    Print every frame's render time and GPU totals
  --json <path>               Write the samples as JSON
  --dt <seconds> --seed <integer>`);
  process.exit(0);
}
