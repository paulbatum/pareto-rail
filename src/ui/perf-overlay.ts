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
};

type BucketReport = {
  second: number;
  avgFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  frames: number;
  counters: PerfCounters;
};

export type PerfReport = {
  levelId: string;
  runDuration: number;
  userAgent: string;
  generatedAt: string;
  buckets: BucketReport[];
};

export function createPerfOverlay(options: PerfOverlayOptions) {
  return new PerfOverlay(options);
}

class PerfOverlay {
  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  private readonly levelId: string;
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
  private readonly root: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly downloadButton: HTMLButtonElement;
  private frameIndex = 0;
  private bucketIndex = 0;
  private runStartedAt = performance.now();
  private lastOverlayUpdate = 0;
  private lastSampleSecond = -1;
  private disposed = false;

  constructor({ renderer, scene, bus, levelId }: PerfOverlayOptions) {
    this.renderer = renderer;
    this.scene = scene;
    this.levelId = levelId;
    this.programs.fill(-1);
    this.root = document.createElement('div');
    this.root.className = 'perf-overlay';
    this.label = document.createElement('div');
    this.downloadButton = document.createElement('button');
    this.downloadButton.type = 'button';
    this.downloadButton.textContent = 'perf json';
    this.downloadButton.addEventListener('click', () => this.downloadReport());
    this.root.append(this.label, this.downloadButton);
    document.body.append(this.root);
    installStyle();
    bus.on('runstart', () => {
      this.runStartedAt = performance.now();
    });
    bus.on('runend', () => {
      logSummary(this.buildReport());
    });
  }

  recordFrame(dtMs: number, now = performance.now()) {
    if (this.disposed) return;
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
    this.root.remove();
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
  }

  private updateOverlay(second: number) {
    const count = this.bucketCount[second];
    const avg = count > 0 ? this.bucketSum[second] / count : 0;
    const fps = avg > 0 ? 1000 / avg : 0;
    const worst = this.bucketMax[second];
    this.label.textContent = `${fps.toFixed(0)} fps · worst ${worst.toFixed(1)} ms · calls ${this.calls[second]} · ${this.sparkline(second)}`;
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
      levelId: this.levelId,
      runDuration: round((performance.now() - this.runStartedAt) / 1000, 3),
      userAgent: navigator.userAgent,
      generatedAt: new Date().toISOString(),
      buckets,
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
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pareto-rail-perf-${safeName(this.levelId)}-${Date.now()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function logSummary(report: PerfReport) {
  console.log(`pareto-rail perf report: ${report.levelId}, ${report.runDuration.toFixed(1)}s`);
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
