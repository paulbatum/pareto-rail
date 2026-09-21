import type { Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { EventBus } from '../events';
import { collectPerfCounters, type PerfCounters } from '../engine/perf-counters';

const MAX_SECONDS = 15 * 60;
const MAX_FPS = 240;
const MAX_FRAMES = MAX_SECONDS * MAX_FPS;
const UPDATE_INTERVAL_MS = 250;
const SPARK_CHARS = '▁▂▃▄▅▆▇█';

type PerfOverlayOptions = {
  renderer: WebGPURenderer;
  scene: Scene;
  bus: EventBus;
  levelId: string;
  /** Diagnostic URL knobs in force, recorded so a capture says what it was measuring. */
  knobs?: Record<string, string>;
};

type BucketReport = {
  second: number;
  avgFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  frames: number;
  /** Milliseconds the GPU spent on the frame, or null when the renderer does not track timestamps. */
  gpuMs: number | null;
  counters: PerfCounters;
};

export type PerfReport = {
  levelId: string;
  runDuration: number;
  /** Drawing surface in device pixels, and the ratio it was derived from. A frame time
      means nothing without it: the post chain and the shadow map scale with this. */
  renderSize: { width: number; height: number; pixelRatio: number; multisampled: boolean; samples: number };
  /** The adapter the browser handed the renderer, where it reports one. */
  adapter: GPUAdapterInfo | null;
  /** Diagnostic URL knobs in force. Empty means the capture is of the shipping frame. */
  knobs: Record<string, string>;
  userAgent: string;
  generatedAt: string;
  buckets: BucketReport[];
};

/** One thing the sweep switches off, and how to put the world into that state. */
export type SweepConfig = { name: string; apply(): void };

export type PerfSweepReport = {
  levelId: string;
  renderSize: PerfReport['renderSize'];
  adapter: GPUAdapterInfo | null;
  knobs: Record<string, string>;
  userAgent: string;
  generatedAt: string;
  sweep: { blockFrames: number; settleFrames: number; rounds: number };
  /** Baseline first; `deltaGpuMs` is what removing that one thing saved. */
  configs: {
    name: string;
    gpuSamples: number;
    medianGpuMs: number | null;
    deltaGpuMs: number | null;
    medianFrameMs: number;
    calls: number;
    triangles: number;
  }[];
};

type SweepRun = {
  configs: { config: SweepConfig; gpu: number[]; frame: number[]; calls: number; triangles: number }[];
  index: number;
  frameInBlock: number;
  rounds: number;
};

/* A block is held long enough for the GPU timestamps to catch up: `readGpuMs` reads the
   most recently resolved query, which lags the frame that produced it. The first frames
   of a block are therefore still reporting the previous config and are thrown away. */
const SWEEP_BLOCK_FRAMES = 18;
const SWEEP_SETTLE_FRAMES = 6;
const SWEEP_ROUNDS = 8;

export function createPerfOverlay(options: PerfOverlayOptions) {
  return new PerfOverlay(options);
}

class PerfOverlay {
  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  private readonly levelId: string;
  private readonly knobs: Record<string, string>;
  private readonly frameMs = new Float32Array(MAX_FRAMES);
  private readonly bucketStart = new Int32Array(MAX_SECONDS);
  private readonly bucketCount = new Int32Array(MAX_SECONDS);
  private readonly bucketSum = new Float64Array(MAX_SECONDS);
  private readonly bucketMax = new Float32Array(MAX_SECONDS);
  private readonly calls = new Int32Array(MAX_SECONDS);
  private readonly triangles = new Float64Array(MAX_SECONDS);
  private readonly geometries = new Int32Array(MAX_SECONDS);
  private readonly textures = new Int32Array(MAX_SECONDS);
  private readonly programs = new Int32Array(MAX_SECONDS);
  private readonly sceneObjects = new Int32Array(MAX_SECONDS);
  private readonly visibleObjects = new Int32Array(MAX_SECONDS);
  private readonly gpuMs = new Float32Array(MAX_SECONDS);
  private readonly root: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly downloadButton: HTMLButtonElement;
  private frameIndex = 0;
  private bucketIndex = 0;
  private runStartedAt = performance.now();
  private lastOverlayUpdate = 0;
  private lastSampleSecond = -1;
  private disposed = false;
  private sweepConfigs: SweepConfig[] = [];
  private sweep: SweepRun | null = null;
  private readonly sweepButton: HTMLButtonElement;
  private sceneSamples: (() => number) | null = null;

  constructor({ renderer, scene, bus, levelId, knobs }: PerfOverlayOptions) {
    this.renderer = renderer;
    this.scene = scene;
    this.levelId = levelId;
    this.knobs = knobs ?? {};
    this.programs.fill(-1);
    this.root = document.createElement('div');
    this.root.className = 'perf-overlay';
    this.label = document.createElement('div');
    this.downloadButton = document.createElement('button');
    this.downloadButton.type = 'button';
    this.downloadButton.textContent = 'perf json';
    this.downloadButton.addEventListener('click', () => this.downloadReport());
    this.sweepButton = document.createElement('button');
    this.sweepButton.type = 'button';
    this.sweepButton.textContent = 'perf sweep';
    this.sweepButton.hidden = true;
    this.sweepButton.addEventListener('click', () => this.startSweep());
    this.root.append(this.label, this.downloadButton, this.sweepButton);
    document.body.append(this.root);
    installStyle();
    bus.on('runstart', () => {
      this.runStartedAt = performance.now();
    });
    bus.on('runend', () => {
      logSummary(this.buildReport());
    });
  }

  /** Offers the sweep button once the caller can put the world into each configuration. */
  setSweepConfigs(configs: SweepConfig[]) {
    this.sweepConfigs = configs;
    this.sweepButton.hidden = configs.length < 2;
  }

  /** Moves the readout into a host container (the debug panel) instead of floating over the game. */
  mount(parent: HTMLElement) {
    this.root.classList.add('perf-overlay-embedded');
    parent.append(this.root);
  }

  recordFrame(dtMs: number, now = performance.now()) {
    if (this.disposed) return;
    if (this.sweep) {
      this.advanceSweep(dtMs);
      return;
    }
    const frameSlot = this.frameIndex % MAX_FRAMES;
    this.frameMs[frameSlot] = dtMs;
    const elapsedSeconds = Math.max(0, (now - this.runStartedAt) / 1000);
    const second = Math.min(MAX_SECONDS - 1, Math.floor(elapsedSeconds));
    if (this.bucketCount[second] === 0) this.bucketStart[second] = frameSlot;
    this.bucketCount[second] += 1;
    this.bucketSum[second] += dtMs;
    if (dtMs > this.bucketMax[second]) this.bucketMax[second] = dtMs;
    this.frameIndex += 1;
    this.bucketIndex = Math.max(this.bucketIndex, second);

    if (second !== this.lastSampleSecond) {
      this.lastSampleSecond = second;
      this.sampleCounters(second);
    }
    if (now - this.lastOverlayUpdate >= UPDATE_INTERVAL_MS) {
      this.lastOverlayUpdate = now;
      this.updateOverlay(second);
    }
  }

  dispose() {
    this.disposed = true;
    if (this.sweep) this.sweepConfigs[0]?.apply();
    this.sweep = null;
    this.root.remove();
  }

  private startSweep() {
    if (this.sweep || this.sweepConfigs.length < 2) return;
    this.sweep = {
      configs: this.sweepConfigs.map((config) => ({ config, gpu: [], frame: [], calls: 0, triangles: 0 })),
      index: 0,
      frameInBlock: 0,
      rounds: 0,
    };
    this.sweepButton.disabled = true;
    this.sweepConfigs[0].apply();
  }

  private advanceSweep(dtMs: number) {
    const sweep = this.sweep;
    if (!sweep) return;
    const slot = sweep.configs[sweep.index];
    if (sweep.frameInBlock >= SWEEP_SETTLE_FRAMES) {
      const gpu = this.readGpuMs();
      if (gpu > 0) slot.gpu.push(gpu);
      slot.frame.push(dtMs);
    }
    if (sweep.frameInBlock === SWEEP_BLOCK_FRAMES - 1) {
      const counters = collectPerfCounters(this.renderer, this.scene);
      slot.calls = counters.calls;
      slot.triangles = counters.triangles;
    }
    sweep.frameInBlock += 1;
    if (sweep.frameInBlock < SWEEP_BLOCK_FRAMES) {
      this.updateSweepLabel(sweep);
      return;
    }
    sweep.frameInBlock = 0;
    sweep.index += 1;
    if (sweep.index >= sweep.configs.length) {
      sweep.index = 0;
      sweep.rounds += 1;
    }
    if (sweep.rounds >= SWEEP_ROUNDS) {
      this.finishSweep(sweep);
      return;
    }
    sweep.configs[sweep.index].config.apply();
    this.updateSweepLabel(sweep);
  }

  private updateSweepLabel(sweep: SweepRun) {
    const done = sweep.rounds * sweep.configs.length + sweep.index;
    const total = SWEEP_ROUNDS * sweep.configs.length;
    this.label.textContent = `sweep ${Math.round((done / total) * 100)}% · ${sweep.configs[sweep.index].config.name}`;
  }

  private finishSweep(sweep: SweepRun) {
    this.sweep = null;
    this.sweepButton.disabled = false;
    sweep.configs[0].config.apply();
    const report = this.buildSweepReport(sweep);
    logSweep(report);
    this.download(report, `sweep-${Date.now()}`);
  }

  private buildSweepReport(sweep: SweepRun): PerfSweepReport {
    const baseline = median(sweep.configs[0].gpu);
    return {
      ...this.environment(),
      sweep: { blockFrames: SWEEP_BLOCK_FRAMES, settleFrames: SWEEP_SETTLE_FRAMES, rounds: SWEEP_ROUNDS },
      configs: sweep.configs.map((slot) => {
        const gpu = median(slot.gpu);
        return {
          name: slot.config.name,
          gpuSamples: slot.gpu.length,
          medianGpuMs: gpu,
          deltaGpuMs: gpu !== null && baseline !== null ? round(gpu - baseline, 3) : null,
          medianFrameMs: median(slot.frame) ?? 0,
          calls: slot.calls,
          triangles: slot.triangles,
        };
      }),
    };
  }

  private sampleCounters(second: number) {
    const counters = collectPerfCounters(this.renderer, this.scene);
    this.calls[second] = counters.calls;
    this.triangles[second] = counters.triangles;
    this.geometries[second] = counters.geometries;
    this.textures[second] = counters.textures;
    this.programs[second] = counters.programs ?? -1;
    this.sceneObjects[second] = counters.sceneObjects;
    this.visibleObjects[second] = counters.visibleObjects;
    this.gpuMs[second] = this.readGpuMs();
  }

  /**
   * The WebGPU backend fills `info.render.timestamp` only when the renderer was
   * constructed with `trackTimestamp: true`, and only after the pending queries are
   * resolved. When tracking is off this returns 0 and the overlay hides the column.
   */
  private readGpuMs() {
    const renderer = this.renderer as WebGPURenderer & {
      backend?: { trackTimestamp?: boolean };
      resolveTimestampsAsync?: (type?: string) => Promise<number | undefined>;
      info: { render: { timestamp?: number } };
    };
    if (renderer.backend?.trackTimestamp !== true) return 0;
    void renderer.resolveTimestampsAsync?.('render').catch(() => undefined);
    const timestamp = renderer.info.render.timestamp;
    return Number.isFinite(timestamp) ? (timestamp as number) : 0;
  }

  private updateOverlay(second: number) {
    const count = this.bucketCount[second];
    const avg = count > 0 ? this.bucketSum[second] / count : 0;
    const fps = avg > 0 ? 1000 / avg : 0;
    const worst = this.bucketMax[second];
    const gpu = this.gpuMs[second];
    const gpuText = gpu > 0 ? ` · gpu ${gpu.toFixed(1)} ms` : '';
    this.label.textContent = `${fps.toFixed(0)} fps · worst ${worst.toFixed(1)} ms · calls ${this.calls[second]}${gpuText} · ${this.sparkline(second)}`;
  }

  private sparkline(second: number) {
    let max = 1;
    const start = Math.max(0, second - 4);
    for (let s = start; s <= second; s += 1) if (this.bucketMax[s] > max) max = this.bucketMax[s];
    let text = '';
    for (let s = start; s <= second; s += 1) {
      const value = this.bucketMax[s];
      const index = Math.min(SPARK_CHARS.length - 1, Math.floor((value / max) * (SPARK_CHARS.length - 1)));
      text += SPARK_CHARS[index];
    }
    return text.padStart(5, SPARK_CHARS[0]);
  }

  private buildReport(): PerfReport {
    const buckets: BucketReport[] = [];
    const latest = Math.min(this.bucketIndex, MAX_SECONDS - 1);
    for (let second = 0; second <= latest; second += 1) {
      const frames = this.bucketCount[second];
      if (frames === 0) continue;
      buckets.push({
        second,
        avgFrameMs: round(this.bucketSum[second] / frames, 3),
        p95FrameMs: round(this.percentile(second, 0.95), 3),
        p99FrameMs: round(this.percentile(second, 0.99), 3),
        maxFrameMs: round(this.bucketMax[second], 3),
        frames,
        gpuMs: this.gpuMs[second] > 0 ? round(this.gpuMs[second], 3) : null,
        counters: {
          calls: this.calls[second],
          triangles: this.triangles[second],
          geometries: this.geometries[second],
          textures: this.textures[second],
          programs: this.programs[second] >= 0 ? this.programs[second] : null,
          sceneObjects: this.sceneObjects[second],
          visibleObjects: this.visibleObjects[second],
        },
      });
    }
    return {
      ...this.environment(),
      runDuration: round((performance.now() - this.runStartedAt) / 1000, 3),
      buckets,
    };
  }

  /** Reads the scene pass's MSAA samples once the post chain exists; without it the canvas's own count is reported. */
  setSceneSamples(read: () => number) {
    this.sceneSamples = read;
  }

  /** What the numbers were measured on. Shared by both reports. */
  private environment() {
    const drawing = this.renderer.domElement;
    const backend = (this.renderer as WebGPURenderer & {
      backend?: { parameters?: { antialias?: boolean }; device?: { adapterInfo?: GPUAdapterInfo } };
    }).backend;
    const info = backend?.device?.adapterInfo;
    const samples = this.sceneSamples?.() ?? this.renderer.samples;
    return {
      levelId: this.levelId,
      renderSize: {
        width: drawing.width,
        height: drawing.height,
        pixelRatio: round(this.renderer.getPixelRatio(), 3),
        multisampled: samples > 1,
        samples,
      },
      adapter: info
        ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } as GPUAdapterInfo
        : null,
      knobs: this.knobs,
      userAgent: navigator.userAgent,
      generatedAt: new Date().toISOString(),
    };
  }

  private percentile(second: number, p: number) {
    const count = this.bucketCount[second];
    if (count === 0) return 0;
    const values = new Array<number>(count);
    const start = this.bucketStart[second];
    for (let i = 0; i < count; i += 1) values[i] = this.frameMs[(start + i) % MAX_FRAMES];
    values.sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))];
  }

  private downloadReport() {
    const report = this.buildReport();
    logSummary(report);
    this.download(report, String(Date.now()));
  }

  private download(report: object, suffix: string) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    /* The knobs go in the filename too: a folder of captures is unreadable when only
       the timestamp tells them apart. */
    const knobs = Object.entries(this.knobs).map(([name, value]) => `${name}${value}`).join('-');
    anchor.download = `pareto-rail-perf-${safeName(this.levelId)}${knobs ? `-${safeName(knobs)}` : ''}-${suffix}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return round(value, 3);
}

function logSweep(report: PerfSweepReport) {
  console.log(`pareto-rail perf sweep: ${report.levelId}, ${report.configs.length} configurations`);
  console.table(report.configs.map((config) => ({
    config: config.name,
    gpuMs: config.medianGpuMs,
    'vs baseline': config.deltaGpuMs,
    frameMs: config.medianFrameMs,
    calls: config.calls,
    tris: config.triangles,
    samples: config.gpuSamples,
  })));
}

function logSummary(report: PerfReport) {
  const knobs = Object.entries(report.knobs).map(([name, value]) => `${name}=${value}`).join(' ');
  console.log(`pareto-rail perf report: ${report.levelId}, ${report.runDuration.toFixed(1)}s${knobs ? ` (${knobs})` : ''}`);
  console.table(report.buckets.map((bucket) => ({
    t: bucket.second,
    avg: bucket.avgFrameMs,
    p95: bucket.p95FrameMs,
    p99: bucket.p99FrameMs,
    max: bucket.maxFrameMs,
    calls: bucket.counters.calls,
    tris: bucket.counters.triangles,
    objects: bucket.counters.sceneObjects,
    visible: bucket.counters.visibleObjects,
    geoms: bucket.counters.geometries,
    programs: bucket.counters.programs,
  })));
}

function installStyle() {
  if (document.getElementById('pareto-rail-perf-overlay-style')) return;
  const style = document.createElement('style');
  style.id = 'pareto-rail-perf-overlay-style';
  style.textContent = `
    .perf-overlay {
      position: fixed;
      left: 8px;
      top: 8px;
      z-index: 20;
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 4px 6px;
      border: 1px solid rgba(142, 238, 255, 0.35);
      border-radius: 4px;
      background: rgba(1, 5, 10, 0.72);
      color: #d8fbff;
      font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      pointer-events: auto;
      user-select: none;
    }
    .perf-overlay-embedded {
      position: static;
      justify-content: space-between;
      border: 0;
      border-radius: 0;
      padding: 0;
      background: none;
    }
    .perf-overlay button[disabled] {
      opacity: 0.5;
      cursor: default;
    }
    .perf-overlay button {
      padding: 1px 4px;
      border: 1px solid rgba(142, 238, 255, 0.45);
      border-radius: 3px;
      background: rgba(6, 18, 28, 0.8);
      color: #d8fbff;
      font: inherit;
      cursor: pointer;
    }
  `;
  document.head.append(style);
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'level';
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
