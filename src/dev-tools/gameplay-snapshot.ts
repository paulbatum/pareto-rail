import {
  Color,
  LineBasicMaterial,
  Material,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointsMaterial,
  Raycaster,
  Scene,
  Vector3,
  type Camera,
  type Intersection,
  type Object3D,
} from 'three';
import { WebGPURenderer, type WebGPURendererParameters } from 'three/webgpu';
import { createEventBus } from '../events';
import { createPost } from '../engine/post';
import { withoutShadowDependentStages } from '../engine/post-stages';
import { applyInitializedRenderConfig, applyRenderConfig, CAMERA_NEAR, resolveCameraFar } from '../engine/render-config';
import { collectPerfCounters, type PerfCounters } from '../engine/perf-counters';
import type { Hud } from '../ui/hud';
import { findLevelEntry, getLevelById } from '../levels';
import type { LevelDefinition } from '../engine/types';

// Dev-only fixture levels under src/dev-tools/levels/<id>/index.ts. They are
// reachable only from this page, by id, and only when the id is not a
// registered or benchmark level.
const devFixtureModules = import.meta.glob<{ default: LevelDefinition }>('./levels/*/index.ts');

type Fidelity = 'full' | 'postless' | 'flat';
type Backend = 'webgpu' | 'webgl';

type OcclusionOptions = {
  dt?: number;
  sampleStep?: number;
  threshold?: number;
  minOnscreenSamples?: number;
  minOccludedSeconds?: number;
  severeOccludedSeconds?: number;
  minWarningTargets?: number;
  warningTargetRatio?: number;
  includeTargetsAsOccluders?: boolean;
  policy?: 'none' | 'perfect';
};

type OcclusionTargetReport = {
  enemyId: number;
  kind: string;
  letter?: string;
  spawnedAt: number;
  removedAt: number | null;
  onscreenSeconds: number;
  occludedSeconds: number;
  occludedRatio: number;
  samples: number;
  occludedSamples: number;
  firstOccludedAt: number | null;
  worstOccluder: string | null;
};

type OcclusionReport = {
  level: { id: string; title: string; duration: number | null };
  threshold: number;
  sampleStep: number;
  minOccludedSeconds: number;
  severeOccludedSeconds: number;
  minWarningTargets: number;
  warningTargetRatio: number;
  requiredWarningTargets: number;
  dt: number;
  elapsed: number;
  targets: OcclusionTargetReport[];
  warnings: OcclusionTargetReport[];
  severe: OcclusionTargetReport[];
  failed: boolean;
  failureReason: string | null;
};

type PerfStepOptions = {
  dt?: number;
  targetTime: number;
  /**
   * `realtime` steps one frame per animation frame and reports the wall-clock time between
   * frames, which is what a player sees: a GPU that falls behind or a driver compile shows
   * up as a long frame. Off, the page steps synchronously, the render's CPU time is reported,
   * and the `render` page parameter decides whether every frame or only the last one renders.
   */
  realtime?: boolean;
};

type PerfProbeOptions = {
  dt?: number;
  /** Frames to step and render from the current time. */
  frames: number;
  /** Do not update the runtime or advance elapsed time; render the exact current state. */
  freeze?: boolean;
  /** Frames rendered before measured frames and excluded from all statistics. */
  warmupFrames?: number;
  /** Return every frame's timings and cache sizes as well as the medians. */
  detail?: boolean;
};

type PerfProbeFrame = {
  t: number;
  updateMs: number;
  renderMs: number;
  gpuRenderMs: number | null;
  gpuComputeMs: number | null;
  gpuTotalMs: number | null;
  /** Render pipelines the renderer holds after the frame; a rise means a compile happened in it. */
  pipelines: number | null;
  /** Node builder states (shader programs built from node graphs) the renderer holds after the frame. */
  builders: number | null;
  calls: number;
};

type PerfProbeSample = PerfCounters & {
  t: number;
  state: string;
  frames: number;
  /** CPU milliseconds inside the level's update, median over the frames. */
  updateMs: number;
  /** CPU milliseconds inside the render call, median over the frames. */
  renderMs: number;
  /** CPU milliseconds of the first measured render after stepping to this time. */
  firstRenderMs: number;
  renderMaxMs: number;
  /** GPU milliseconds for every render pass of a frame, median, or null without timestamp queries. */
  gpuRenderMs: number | null;
  /** GPU milliseconds for every compute dispatch of a frame, median, or null without timestamp queries. */
  gpuComputeMs: number | null;
  gpuRenderMaxMs: number | null;
  /** Total render plus compute GPU milliseconds per frame, median, or null when unavailable. */
  gpuTotalMs: number | null;
  /** p95 total render plus compute GPU milliseconds per measured frame. */
  gpuTotalP95Ms: number | null;
  /** Number of measured frames with complete GPU timestamps. */
  gpuSamples: number;
  detail?: PerfProbeFrame[];
};

type PerfStepSample = PerfCounters & {
  t: number;
  state: string;
  frames: number;
  avgFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  heapUsedMB: number | null;
};

type GameplaySnapshotApi = {
  ready: Promise<void>;
  capture(): Promise<{ dataUrl: string; luminance: number; fidelity: Fidelity; backend: Backend; state: string; seed: number | null }>;
  analyzeOcclusion(options?: OcclusionOptions): Promise<OcclusionReport>;
  stepPerformance(options: PerfStepOptions): Promise<PerfStepSample>;
  probePerformance(options: PerfProbeOptions): Promise<PerfProbeSample>;
  metadata(): {
    duration: number | null;
    fidelity: Fidelity;
    backend: Backend;
    state: string;
    bpm: number | null;
    perfProfile: 'default' | 'flagship' | null;
    markers: Record<string, number>;
    sections: Array<{ name: string; time: number }>;
    adapter: { vendor?: string; architecture?: string; device?: string; description?: string } | null;
    renderSize: { width: number; height: number; multisampled: boolean; samples: number };
    timestampAvailable: boolean;
    /** Whether the renderer is drawing the shadow pass, so a probe records what it measured. */
    shadowsEnabled: boolean;
  };
};

type SnapshotRenderer = WebGPURenderer & {
  domElement: HTMLCanvasElement;
  info?: { reset?: () => void; frame?: number };
  render(scene: Scene, camera: Camera): void;
};

type SnapshotRendererParameters = WebGPURendererParameters & {
  forceWebGL: boolean;
  preserveDrawingBuffer: true;
  trackTimestamp: boolean;
};

type TimestampPool = {
  frames: number[];
  timestamps: Map<string, number>;
  currentQueryIndex: number;
};

type SnapshotRendererInternals = SnapshotRenderer & {
  _animation?: { stop(): void };
  backend?: {
    trackTimestamp?: boolean;
    device?: { adapterInfo?: { vendor?: string; architecture?: string; device?: string; description?: string } };
    timestampQueryPool?: Record<string, TimestampPool | null>;
  };
  resolveTimestampsAsync?: (type: 'render' | 'compute') => Promise<number | undefined>;
  _pipelines?: { caches?: Map<string, unknown> };
  _nodes?: { nodeBuilderCache?: Map<string, unknown> } & SnapshotRendererInternalsNodes;
};

type SnapshotRendererInternalsNodes = {
  nodeFrame?: {
    time: number;
    deltaTime: number;
    frameId: number;
    lastTime?: number;
  };
};

type PostRenderer = ReturnType<typeof createPost>;

type RenderableObject = Object3D & {
  material?: Material | Material[];
  isLine?: boolean;
  isMesh?: boolean;
  isPoints?: boolean;
};

type TargetRecord = {
  enemyId: number;
  kind: string;
  letter?: string;
  root: Object3D;
  spawnedAt: number;
  removedAt: number | null;
  onscreenSeconds: number;
  occludedSeconds: number;
  samples: number;
  occludedSamples: number;
  firstOccludedAt: number | null;
  occluders: Map<string, number>;
  locks: number;
  inFlight: boolean;
};

declare global {
  interface Window {
    __gameplaySnapshot: GameplaySnapshotApi;
    __nativeRandom?: () => number;
    __snapshotSeed?: number;
  }
}

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DT = 1 / 60;
// Tuned against a full-corpus measurement: of 5856 targets across 77 levels only 8
// were occluded at all and the longest block was 0.5s. The duration floor sits well
// above that noise and well below the tens of seconds this check exists to catch.
const DEFAULT_MIN_OCCLUDED_SECONDS = 2;
const DEFAULT_SEVERE_OCCLUDED_SECONDS = 8;
const DEFAULT_MIN_WARNING_TARGETS = 3;
const DEFAULT_WARNING_TARGET_RATIO = 0.05;
// The duration floor decides a warning on its own. The ratio stays available as a
// stricter opt-in, so its default admits every target with any occlusion.
const DEFAULT_OCCLUSION_THRESHOLD = 0;
const SCRATCH_CANVAS = document.createElement('canvas');
const SCRATCH_CONTEXT = SCRATCH_CANVAS.getContext('2d', { willReadFrequently: true });
const OCCLUSION_RAYCASTER = new Raycaster();
const CAMERA_WORLD = new Vector3();
const TARGET_WORLD = new Vector3();
const TARGET_NDC = new Vector3();
const RAY_DIRECTION = new Vector3();

const params = new URLSearchParams(window.location.search);
const width = readPositiveNumber(params.get('width')) ?? DEFAULT_WIDTH;
const height = readPositiveNumber(params.get('height')) ?? DEFAULT_HEIGHT;
const targetTime = readNonNegativeNumber(params.get('time')) ?? 0;
const fixedDt = readPositiveNumber(params.get('dt')) ?? DEFAULT_DT;
const fidelity = readFidelity(params.get('fidelity'));
const requestedBackend = readBackend(params.get('backend'));
const showProjectiles = params.get('projectiles') === '1';
/** Drive the run with the perfect lock-on policy while advancing to the capture time, so stills show a played run. */
const autoplay = params.get('autoplay') === '1';
const startScreen = params.get('startScreen') === '1';
const skipRenders = params.get('render') === 'sample';
// Perf probing: GPU timestamp queries, and knobs that remove one cost at a time so a
// probe can attribute frame time. Every knob defaults to the level as authored.
const trackTimestamps = params.get('timestamps') === '1';
const hiddenObjectNames = readList(params.get('hide'));
const droppedStageTypes = readList(params.get('dropStages'));
/** `flatten=<material names>` swaps those materials for unlit ones, keeping the geometry and its depth coverage. */
const flattenedMaterialNames = readList(params.get('flatten'));
const velocityBufferOverride = readBooleanOverride(params.get('velocityBuffer'));
/** `shadows=0` drops the shadow pass, another whole render of the scene, and with it the post
    stages that march the map. Matches the playtest knob. */
const shadowsEnabled = params.get('shadows') !== '0';
/** `msaa=0` builds the renderer without multisampling. Matches the playtest knob. */
const multisampled = params.get('msaa') !== '0';

let renderer: SnapshotRenderer | null = null;
let activeBackend: Backend = requestedBackend;
let post: PostRenderer | null = null;
let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
let runtimeState = 'unknown';
let runDuration: number | null = null;
let selectedLevel: LevelDefinition | null = null;
let runtimeUpdate: ((dt: number, elapsed: number) => void) | null = null;
let currentElapsed = 0;
let currentLocks = 0;
let pointerDown = false;
const targetRecords = new Map<number, TargetRecord>();

window.__raildDebug = {
  ...window.__raildDebug,
  immortal: params.get('immortal') === '1',
};

window.__gameplaySnapshot = {
  ready: bootstrap(),
  async capture() {
    if (!renderer || !scene || !camera) throw new Error('Gameplay snapshot renderer is not ready');
    setRendererFrameTime(renderer, targetTime, fixedDt);
    if (post) post.render({ dt: fixedDt });
    else renderer.render(scene, camera);
    const luminance = measureLuminance(renderer.domElement);
    return {
      dataUrl: renderer.domElement.toDataURL('image/png'),
      luminance,
      fidelity,
      backend: activeBackend,
      state: runtimeState,
      seed: window.__snapshotSeed ?? null,
    };
  },
  async analyzeOcclusion(options = {}) {
    return analyzeTargetOcclusion(options);
  },
  async stepPerformance(options) {
    return stepPerformance(options);
  },
  async probePerformance(options) {
    return probePerformance(options);
  },
  metadata() {
    const internals = renderer as SnapshotRendererInternals | null;
    const info = internals?.backend?.device?.adapterInfo;
    const drawing = renderer?.domElement;
    // With post on, the scene pass's own count, which multisampleMaxPixels can lower below renderer.samples.
    const samples = post ? post.sceneSamples() : renderer?.samples ?? 0;
    return {
      duration: runDuration,
      fidelity,
      backend: activeBackend,
      state: runtimeState,
      bpm: selectedLevel ? selectedLevel.bpm : null,
      perfProfile: selectedLevel ? (selectedLevel.perfProfile ?? null) : null,
      markers: selectedLevel ? (selectedLevel.markers ?? {}) : {},
      sections: selectedLevel ? (selectedLevel.sections ?? []) : [],
      adapter: info ? {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
      } : null,
      renderSize: {
        width: drawing?.width ?? 0,
        height: drawing?.height ?? 0,
        multisampled: samples > 1,
        samples,
      },
      timestampAvailable: Boolean(internals?.backend?.trackTimestamp === true && typeof internals?.resolveTimestampsAsync === 'function'),
      shadowsEnabled: renderer?.shadowMap.enabled ?? false,
    };
  },
};

async function loadSnapshotLevel(id: string | null): Promise<LevelDefinition> {
  if (id !== null && findLevelEntry(id) === undefined) {
    const fixture = devFixtureModules[`./levels/${id}/index.ts`];
    if (fixture) return (await fixture()).default;
  }
  return getLevelById(id);
}

async function bootstrap() {
  selectedLevel = await loadSnapshotLevel(params.get('level'));
  document.title = `Pareto Rail gameplay snapshot — ${selectedLevel.title}`;

  scene = new Scene();
  camera = new PerspectiveCamera(62, width / height, CAMERA_NEAR, resolveCameraFar(selectedLevel.render));

  const rendererParams = {
    antialias: multisampled,
    alpha: false,
    forceWebGL: requestedBackend === 'webgl',
    preserveDrawingBuffer: true,
    trackTimestamp: trackTimestamps,
  } as SnapshotRendererParameters;
  renderer = new WebGPURenderer(rendererParams) as SnapshotRenderer;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(selectedLevel.post?.clearColor ?? 0x02040a, 1);
  applyRenderConfig(renderer, selectedLevel.render);
  if (!shadowsEnabled) renderer.shadowMap.enabled = false;
  await renderer.init();
  applyInitializedRenderConfig(renderer, selectedLevel.render);
  activeBackend = readActiveBackend(renderer);
  stopRendererAnimation(renderer);
  document.body.append(renderer.domElement);

  const bus = createEventBus();
  runtimeState = 'attract';
  bus.on('runstart', ({ duration }) => {
    runtimeState = 'running';
    runDuration = duration;
  });
  bus.on('runend', () => {
    runtimeState = 'ended';
  });
  bus.on('spawn', ({ enemyId, kind, letter }) => {
    if (kind === 'letter') return;
    const root = findTargetRoot(enemyId);
    if (!root) return;
    targetRecords.set(enemyId, {
      enemyId,
      kind,
      letter,
      root,
      spawnedAt: currentElapsed,
      removedAt: null,
      onscreenSeconds: 0,
      occludedSeconds: 0,
      samples: 0,
      occludedSamples: 0,
      firstOccludedAt: null,
      occluders: new Map(),
      locks: 0,
      inFlight: false,
    });
  });
  bus.on('lock', ({ enemyId, lockCount }) => {
    currentLocks = lockCount;
    const record = targetRecords.get(enemyId);
    if (record) record.locks += 1;
  });
  bus.on('unlock', ({ enemyId, lockCount }) => {
    currentLocks = lockCount;
    const record = targetRecords.get(enemyId);
    if (record) record.locks = 0;
  });
  bus.on('fire', ({ enemyId }) => {
    const record = targetRecords.get(enemyId);
    if (record) record.inFlight = true;
  });
  bus.on('hit', ({ enemyId }) => {
    const record = targetRecords.get(enemyId);
    if (record) record.inFlight = false;
  });
  bus.on('reject', () => {
    currentLocks = 0;
    for (const record of targetRecords.values()) {
      record.locks = 0;
      record.inFlight = false;
    }
  });
  const markTargetRemoved = (enemyId: number) => {
    const record = targetRecords.get(enemyId);
    if (record && record.removedAt === null) record.removedAt = currentElapsed;
  };
  bus.on('kill', ({ enemyId }) => markTargetRemoved(enemyId));
  bus.on('miss', ({ enemyId }) => markTargetRemoved(enemyId));

  const runtime = selectedLevel.createRuntime({
    scene,
    camera,
    renderer,
    canvas: renderer.domElement,
    bus,
    hud: createSnapshotHud(),
    onPause: () => {},
    onFullscreen: () => {},
    startTip: '',
    debugValue: params.get('debugValue') ?? undefined,
  });

  runtimeUpdate = runtime.update;
  if (!startScreen) startRunViaInput();
  // Stop one step short: the post chain renders that frame so the capture has a previous frame to blur against.
  const primeTime = Math.max(0, targetTime - fixedDt);
  advanceRuntime(runtime.update, primeTime, fixedDt);

  if (!showProjectiles) hideProjectiles(scene);
  hideNamedObjects(scene, hiddenObjectNames);
  flattenNamedMaterials(scene, flattenedMaterialNames);
  if (fidelity === 'flat') replaceSceneMaterials(scene);
  if (fidelity === 'full') post = createPost(renderer, scene, camera, probePostConfig(selectedLevel.post));
  if (post && primeTime < targetTime) {
    setRendererFrameTime(renderer, currentElapsed, fixedDt);
    post.render({ dt: fixedDt });
  }
  advanceRuntime(runtime.update, targetTime, fixedDt);
}

/** The level's post config with the probe knobs applied. */
function probePostConfig(config: LevelDefinition['post']) {
  if (!config) return config;
  const stages = droppedStageTypes.length > 0 ? (config.stages ?? []).filter((stage) => !droppedStageTypes.includes(stage.type)) : config.stages;
  const velocityBuffer = velocityBufferOverride ?? config.velocityBuffer;
  const withKnobs = { ...config, stages, velocityBuffer };
  return shadowsEnabled ? withKnobs : withoutShadowDependentStages(withKnobs);
}

function hideNamedObjects(root: Scene, names: string[]) {
  for (const name of names) {
    const object = root.getObjectByName(name);
    if (!object) throw new Error(`hide: no scene object named "${name}"`);
    object.visible = false;
  }
}

/**
 * Swaps the named materials for unlit ones. Unlike hiding an object this keeps the
 * geometry, so what the meshes covered stays covered and the difference is the shading.
 */
function flattenNamedMaterials(root: Scene, names: string[]) {
  if (names.length === 0) return;
  const seen = new Set<string>();
  root.traverse((object) => {
    const renderable = object as RenderableObject;
    const material = renderable.material;
    if (!material || Array.isArray(material)) return;
    if (!names.includes(material.name)) return;
    seen.add(material.name);
    renderable.material = createFallbackMaterial(material, renderable);
  });
  const missing = names.filter((name) => !seen.has(name));
  if (missing.length > 0) throw new Error(`flatten: no scene material named ${missing.map((name) => `"${name}"`).join(', ')}`);
}

function startRunViaInput() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
}

function stopRendererAnimation(value: SnapshotRenderer) {
  (value as SnapshotRendererInternals)._animation?.stop();
}
function setRendererFrameTime(value: SnapshotRenderer, seconds: number, dt: number) {
  const internals = value as SnapshotRendererInternals;
  const nodeFrame = internals._nodes?.nodeFrame;
  const frameId = Math.max(value.info?.frame ?? 0, nodeFrame?.frameId ?? 0) + 1;
  if (nodeFrame) {
    nodeFrame.time = seconds;
    nodeFrame.deltaTime = dt;
    nodeFrame.frameId = frameId;
    nodeFrame.lastTime = 0;
  }
  if (value.info) value.info.frame = frameId;
}

function advanceRuntime(update: (dt: number, elapsed: number) => void, seconds: number, dt: number) {
  while (currentElapsed < seconds - 0.000001) {
    const step = Math.min(dt, seconds - currentElapsed);
    if (autoplay) drivePerfectOcclusionPolicy();
    currentElapsed += step;
    update(step, currentElapsed);
  }
}

async function stepPerformance(options: PerfStepOptions): Promise<PerfStepSample> {
  if (!scene || !camera || !renderer || !runtimeUpdate) throw new Error('Gameplay snapshot runtime is not ready');
  const dt = readOptionPositiveNumber(options.dt, fixedDt, 'dt');
  const targetTime = readOptionNonNegativeNumber(options.targetTime, currentElapsed, 'targetTime');
  const frameTimes: number[] = options.realtime ? await stepRealtime(targetTime, dt) : [];

  while (!options.realtime && currentElapsed < targetTime - 0.000001 && runtimeState !== 'ended') {
    const step = Math.min(dt, targetTime - currentElapsed);
    currentElapsed += step;
    runtimeUpdate(step, currentElapsed);
    // A sampled step still renders its last two frames, so the target frame's motion blur spans one step.
    const primes = skipRenders && post !== null && currentElapsed >= targetTime - dt - 0.000001 && currentElapsed < targetTime - 0.000001;
    if (!skipRenders || primes) {
      const before = performance.now();
      setRendererFrameTime(renderer, currentElapsed, step);
      renderer.info?.reset?.();
      if (post) post.render({ dt: step });
      else renderer.render(scene, camera);
      if (!primes) frameTimes.push(performance.now() - before);
    }
  }

  if (skipRenders || frameTimes.length === 0) {
    const before = performance.now();
    setRendererFrameTime(renderer, currentElapsed, dt);
    renderer.info?.reset?.();
    if (post) post.render({ dt });
    else renderer.render(scene, camera);
    frameTimes.push(performance.now() - before);
  }

  const counters = collectPerfCounters(renderer, scene);
  return {
    t: roundSeconds(currentElapsed),
    state: runtimeState,
    frames: frameTimes.length,
    avgFrameMs: roundMillis(mean(frameTimes)),
    p95FrameMs: roundMillis(percentile(frameTimes, 0.95)),
    p99FrameMs: roundMillis(percentile(frameTimes, 0.99)),
    maxFrameMs: roundMillis(max(frameTimes)),
    heapUsedMB: readInPageHeapUsedMB(),
    ...counters,
  };
}

/** One frame per animation frame up to `targetTime`; returns the wall-clock milliseconds between consecutive frames. */
function stepRealtime(targetTime: number, dt: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const deltas: number[] = [];
    let previous: number | null = null;
    const frame = (now: number) => {
      try {
        if (!(scene && camera && renderer && runtimeUpdate)) throw new Error('Gameplay snapshot runtime is not ready');
        if (currentElapsed >= targetTime - 0.000001 || runtimeState === 'ended') {
          resolve(deltas);
          return;
        }
        if (previous !== null) deltas.push(now - previous);
        previous = now;
        const step = Math.min(dt, targetTime - currentElapsed);
        currentElapsed += step;
        runtimeUpdate(step, currentElapsed);
        setRendererFrameTime(renderer, currentElapsed, step);
        renderer.info?.reset?.();
        if (post) post.render({ dt: step });
        else renderer.render(scene, camera);
        requestAnimationFrame(frame);
      } catch (error) {
        reject(error);
      }
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Steps and renders `frames` measured frames from the current time, timing the level
 * update and render call on the CPU and, with `timestamps=1`, render passes and compute
 * dispatches on the GPU. Warmup frames are real renders but excluded from all returned
 * statistics. Frozen probes render the exact current runtime state with zero renderer dt.
 */
async function probePerformance(options: PerfProbeOptions): Promise<PerfProbeSample> {
  if (!scene || !camera || !renderer || !runtimeUpdate) throw new Error('Gameplay snapshot runtime is not ready');
  const dt = readOptionPositiveNumber(options.dt, fixedDt, 'dt');
  const frames = readOptionPositiveInteger(options.frames, 1, 'frames');
  const warmupFrames = readOptionNonNegativeInteger(options.warmupFrames, 0, 'warmupFrames');
  const freeze = options.freeze === true;
  const updateTimes: number[] = [];
  const renderTimes: number[] = [];
  const gpuRenderTimes: number[] = [];
  const gpuComputeTimes: number[] = [];
  const gpuTotalTimes: number[] = [];
  const internals = renderer as SnapshotRendererInternals;
  const timestamps = internals.backend?.trackTimestamp === true && typeof internals.resolveTimestampsAsync === 'function';
  const detail: PerfProbeFrame[] = [];

  // A previous capture or step may have left resolved queries in the pools. Drain
  // both pools before warmup so no pre-probe work enters measured statistics.
  if (timestamps) {
    await resolveGpuMs(internals, 'render');
    await resolveGpuMs(internals, 'compute');
  }

  const totalFrames = warmupFrames + frames;
  for (let iteration = 0; iteration < totalFrames; iteration += 1) {
    const measured = iteration >= warmupFrames;
    let updateMs = 0;
    if (!freeze) {
      currentElapsed += dt;
      const updateStart = performance.now();
      runtimeUpdate(dt, currentElapsed);
      updateMs = performance.now() - updateStart;
    }
    if (measured) updateTimes.push(updateMs);

    const renderStart = performance.now();
    setRendererFrameTime(renderer, currentElapsed, freeze ? 0 : dt);
    renderer.info?.reset?.();
    if (post) post.render({ dt, advanceMotionBlur: !freeze });
    else renderer.render(scene, camera);
    const renderMs = performance.now() - renderStart;
    if (measured) renderTimes.push(renderMs);

    let gpuRenderMs: number | null = null;
    let gpuComputeMs: number | null = null;
    let gpuTotalMs: number | null = null;
    if (timestamps) {
      gpuRenderMs = await resolveGpuMs(internals, 'render');
      gpuComputeMs = await resolveGpuMs(internals, 'compute');
      if (gpuRenderMs !== null && gpuComputeMs !== null) {
        gpuTotalMs = gpuRenderMs + gpuComputeMs;
        if (measured) {
          gpuRenderTimes.push(gpuRenderMs);
          gpuComputeTimes.push(gpuComputeMs);
          gpuTotalTimes.push(gpuTotalMs);
        }
      }
    }
    if (measured && options.detail) {
      detail.push({
        t: roundSeconds(currentElapsed),
        updateMs: roundMillis(updateMs),
        renderMs: roundMillis(renderMs),
        gpuRenderMs: gpuRenderMs === null ? null : roundMillis(gpuRenderMs),
        gpuComputeMs: gpuComputeMs === null ? null : roundMillis(gpuComputeMs),
        gpuTotalMs: gpuTotalMs === null ? null : roundMillis(gpuTotalMs),
        pipelines: internals._pipelines?.caches?.size ?? null,
        builders: internals._nodes?.nodeBuilderCache?.size ?? null,
        calls: collectPerfCounters(renderer, scene).calls,
      });
    }
  }

  const counters = collectPerfCounters(renderer, scene);
  return {
    t: roundSeconds(currentElapsed),
    state: runtimeState,
    frames,
    updateMs: roundMillis(median(updateTimes)),
    renderMs: roundMillis(median(renderTimes)),
    firstRenderMs: roundMillis(renderTimes[0]),
    renderMaxMs: roundMillis(max(renderTimes)),
    gpuRenderMs: gpuRenderTimes.length > 0 ? roundMillis(median(gpuRenderTimes)) : null,
    gpuComputeMs: gpuComputeTimes.length > 0 ? roundMillis(median(gpuComputeTimes)) : null,
    gpuRenderMaxMs: gpuRenderTimes.length > 0 ? roundMillis(max(gpuRenderTimes)) : null,
    gpuTotalMs: gpuTotalTimes.length > 0 ? roundMillis(median(gpuTotalTimes)) : null,
    gpuTotalP95Ms: gpuTotalTimes.length > 0 ? roundMillis(percentile(gpuTotalTimes, 0.95)) : null,
    gpuSamples: gpuTotalTimes.length,
    ...counters,
    ...(options.detail ? { detail } : {}),
  };
}

/**
 * Resolves the pending timestamp queries of one pool and sums every pass recorded since
 * the previous resolve. The renderer's own total covers only the last render call, and a
 * post chain or a cube shadow map is many render calls per frame.
 */
async function resolveGpuMs(internals: SnapshotRendererInternals, type: 'render' | 'compute'): Promise<number | null> {
  const pool = internals.backend?.timestampQueryPool?.[type];
  if (!pool) return type === 'compute' ? 0 : null;
  if (pool.currentQueryIndex === 0) return type === 'compute' ? 0 : null;
  await internals.resolveTimestampsAsync?.(type);
  const frames = new Set(pool.frames.map((frame) => `:f${frame}`));
  let total = 0;
  let found = false;
  for (const [uid, duration] of pool.timestamps) {
    if (frames.has(uid.slice(uid.lastIndexOf(':')))) {
      total += duration;
      found = true;
    }
  }
  // The pool keeps every uid it has ever resolved; drop the ones just summed so they are not counted again.
  for (const uid of [...pool.timestamps.keys()]) {
    if (frames.has(uid.slice(uid.lastIndexOf(':')))) pool.timestamps.delete(uid);
  }
  return found && Number.isFinite(total) && total >= 0 ? total : null;
}

async function analyzeTargetOcclusion(options: OcclusionOptions): Promise<OcclusionReport> {
  if (!scene || !camera || !runtimeUpdate || !selectedLevel) throw new Error('Gameplay snapshot runtime is not ready');
  if (currentElapsed > 0.001) throw new Error('Occlusion analysis must start from a fresh page at time=0');

  const dt = readOptionPositiveNumber(options.dt, fixedDt, 'dt');
  const sampleStep = readOptionPositiveNumber(options.sampleStep, 0.1, 'sampleStep');
  const threshold = readOptionNonNegativeNumber(options.threshold, DEFAULT_OCCLUSION_THRESHOLD, 'threshold');
  const minOnscreenSamples = readOptionPositiveInteger(options.minOnscreenSamples, 3, 'minOnscreenSamples');
  const minOccludedSeconds = readOptionNonNegativeNumber(options.minOccludedSeconds, DEFAULT_MIN_OCCLUDED_SECONDS, 'minOccludedSeconds');
  const severeOccludedSeconds = readOptionNonNegativeNumber(options.severeOccludedSeconds, DEFAULT_SEVERE_OCCLUDED_SECONDS, 'severeOccludedSeconds');
  const minWarningTargets = readOptionPositiveInteger(options.minWarningTargets, DEFAULT_MIN_WARNING_TARGETS, 'minWarningTargets');
  const warningTargetRatio = readOptionNonNegativeNumber(options.warningTargetRatio, DEFAULT_WARNING_TARGET_RATIO, 'warningTargetRatio');
  const includeTargetsAsOccluders = options.includeTargetsAsOccluders === true;
  const policy = options.policy ?? 'perfect';
  let nextSampleAt = 0;
  const maxElapsed = (runDuration ?? 0) + 12;

  while (runtimeState !== 'ended' && currentElapsed < maxElapsed - 0.000001) {
    const step = Math.min(dt, maxElapsed - currentElapsed);
    if (policy === 'perfect') drivePerfectOcclusionPolicy();
    currentElapsed += step;
    runtimeUpdate(step, currentElapsed);
    if (currentElapsed + 1e-9 >= nextSampleAt) {
      sampleTargetOcclusion(currentElapsed, sampleStep, includeTargetsAsOccluders);
      nextSampleAt += sampleStep;
    }
  }

  if (renderer) releasePointer(renderer.domElement);
  for (const record of targetRecords.values()) if (record.removedAt === null) record.removedAt = currentElapsed;
  const targets = [...targetRecords.values()].map((record) => serializeOcclusionTarget(record));
  const warnings = targets.filter((target) => (
    target.samples >= minOnscreenSamples
    && target.occludedSeconds >= minOccludedSeconds
    && target.occludedRatio > threshold
  ));

  // One target blocked long enough on its own is a defect, and so is a spread of
  // shorter blocks across many targets. Either condition fails the level; a lone
  // warning below the severe duration does not.
  const severe = warnings.filter((target) => target.occludedSeconds >= severeOccludedSeconds);
  const requiredWarningTargets = Math.max(minWarningTargets, Math.ceil(warningTargetRatio * targets.length));
  const prevalent = warnings.length >= requiredWarningTargets;
  let failureReason: string | null = null;
  if (severe.length > 0) {
    failureReason = `${severe.length} target${severe.length === 1 ? '' : 's'} occluded for at least ${severeOccludedSeconds}s`;
  } else if (prevalent) {
    failureReason = `${warnings.length} of ${targets.length} targets warned, at or above the ${requiredWarningTargets}-target failure count`;
  }

  return {
    level: { id: selectedLevel.id, title: selectedLevel.title, duration: runDuration },
    threshold,
    sampleStep,
    minOccludedSeconds,
    severeOccludedSeconds,
    minWarningTargets,
    warningTargetRatio,
    requiredWarningTargets,
    dt,
    elapsed: roundSeconds(currentElapsed),
    targets,
    warnings,
    severe,
    failed: failureReason !== null,
    failureReason,
  };
}

/** Seconds the policy aims at one target before it moves on: a target the level has made unlockable would hold it forever. */
const POLICY_STALL_SECONDS = 0.5;
let policyAimId = -1;
let policyAimSince = 0;
let policySkip = 0;

function drivePerfectOcclusionPolicy() {
  if (!renderer || !camera || runtimeState !== 'running') return;
  if (currentLocks >= 6) {
    releasePointer(renderer.domElement);
    return;
  }

  const candidates = visibleLiveTargetRecords()
    .filter((record) => record.locks === 0 && !record.inFlight)
    .sort((a, b) => targetScreenDistance(a) - targetScreenDistance(b));
  if (candidates.length === 0) {
    if (currentLocks > 0) releasePointer(renderer.domElement);
    return;
  }

  const chosen = candidates[policySkip % candidates.length];
  if (chosen.enemyId !== policyAimId) {
    policyAimId = chosen.enemyId;
    policyAimSince = currentElapsed;
  } else if (currentElapsed - policyAimSince > POLICY_STALL_SECONDS) {
    policySkip += 1;
    policyAimSince = currentElapsed;
    if (currentLocks > 0) releasePointer(renderer.domElement);
  }
  const ndc = targetNdc(chosen);
  if (ndc) aimPointer(renderer.domElement, ndc.x, ndc.y);
}

function visibleLiveTargetRecords() {
  if (!camera) return [];
  return [...targetRecords.values()].filter((record) => {
    if (record.removedAt !== null || !record.root.parent) return false;
    const ndc = targetNdc(record);
    return ndc !== null && ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 0.98 && Math.abs(ndc.y) <= 0.98;
  });
}

function targetScreenDistance(record: TargetRecord) {
  const ndc = targetNdc(record);
  return ndc ? Math.hypot(ndc.x, ndc.y) : Infinity;
}

function targetNdc(record: TargetRecord) {
  if (!camera) return null;
  record.root.getWorldPosition(TARGET_WORLD);
  TARGET_NDC.copy(TARGET_WORLD).project(camera);
  return { x: TARGET_NDC.x, y: TARGET_NDC.y, z: TARGET_NDC.z };
}

function aimPointer(canvas: HTMLCanvasElement, ndcX: number, ndcY: number) {
  const x = ((ndcX + 1) / 2) * canvas.width;
  const y = ((1 - ndcY) / 2) * canvas.height;
  dispatchPointer(canvas, pointerDown ? 'pointermove' : 'pointerdown', x, y, 1);
  pointerDown = true;
}

function releasePointer(canvas: HTMLCanvasElement) {
  if (!pointerDown) return;
  dispatchPointer(canvas, 'pointerup', 0, 0, 0);
  pointerDown = false;
}

function dispatchPointer(canvas: HTMLCanvasElement, type: string, clientX: number, clientY: number, buttons: number) {
  canvas.dispatchEvent(new PointerEvent(type, {
    clientX,
    clientY,
    buttons,
    button: 0,
    pointerId: 1,
    bubbles: true,
  }));
}

function sampleTargetOcclusion(time: number, sampleStep: number, includeTargetsAsOccluders: boolean) {
  if (!scene || !camera) return;
  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  camera.getWorldPosition(CAMERA_WORLD);

  for (const record of targetRecords.values()) {
    if (record.removedAt !== null || !record.root.parent) continue;
    record.root.getWorldPosition(TARGET_WORLD);
    TARGET_NDC.copy(TARGET_WORLD).project(camera);
    if (TARGET_NDC.z < -1 || TARGET_NDC.z > 1 || Math.abs(TARGET_NDC.x) > 1 || Math.abs(TARGET_NDC.y) > 1) continue;

    record.samples += 1;
    record.onscreenSeconds += sampleStep;
    const occluder = findOccluder(record, includeTargetsAsOccluders);
    if (!occluder) continue;

    record.occludedSamples += 1;
    record.occludedSeconds += sampleStep;
    if (record.firstOccludedAt === null) record.firstOccludedAt = time;
    const label = labelObject(occluder.object);
    record.occluders.set(label, (record.occluders.get(label) ?? 0) + 1);
  }
}

function findOccluder(record: TargetRecord, includeTargetsAsOccluders: boolean): Intersection<Object3D> | null {
  if (!scene || !camera) return null;
  RAY_DIRECTION.copy(TARGET_WORLD).sub(CAMERA_WORLD);
  const targetDistance = RAY_DIRECTION.length();
  if (targetDistance <= 0.001) return null;
  RAY_DIRECTION.multiplyScalar(1 / targetDistance);
  OCCLUSION_RAYCASTER.set(CAMERA_WORLD, RAY_DIRECTION);
  // Sprite.raycast reads the raycaster's camera; GPU particle systems add sprites to the scene.
  OCCLUSION_RAYCASTER.camera = camera;
  OCCLUSION_RAYCASTER.near = camera.near;
  OCCLUSION_RAYCASTER.far = Math.max(camera.near, targetDistance - Math.max(1.5, targetDistance * 0.03));

  const intersections = OCCLUSION_RAYCASTER.intersectObjects(scene.children, true);
  return intersections.find((hit) => isOccludingHit(hit, record, includeTargetsAsOccluders)) ?? null;
}

function isOccludingHit(hit: Intersection<Object3D>, record: TargetRecord, includeTargetsAsOccluders: boolean) {
  const object = hit.object as RenderableObject;
  if (hit.distance <= 0.01) return false;
  if (!object.visible || !isEffectivelyVisible(object)) return false;
  if (isRelatedObject(object, record.root)) return false;
  const role = nearestRaildRole(object);
  if (role === 'reticle' || role === 'projectile') return false;
  if (!includeTargetsAsOccluders && role === 'target') return false;
  if (!object.isMesh) return false;
  if (hasOcclusionIgnoreFlag(object)) return false;
  if (!isMaterialOccluding(object.material)) return false;
  return true;
}

function isEffectivelyVisible(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function isRelatedObject(object: Object3D, root: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

function nearestRaildRole(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const role = node.userData.raildRole;
    if (typeof role === 'string') return role;
  }
  return null;
}

function hasOcclusionIgnoreFlag(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node.userData.raildIgnoreOcclusion === true) return true;
  }
  return false;
}

function isMaterialOccluding(material: Material | Material[] | undefined) {
  if (!material) return true;
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((item) => item.visible && item.depthTest !== false && item.depthWrite !== false && (!item.transparent || item.opacity >= 0.35));
}

function findTargetRoot(enemyId: number) {
  if (!scene) return null;
  let found: Object3D | null = null;
  scene.traverse((object) => {
    if (found) return;
    if (object.userData.raildRole === 'target' && object.userData.raildEnemyId === enemyId) found = object;
  });
  return found;
}

function serializeOcclusionTarget(record: TargetRecord): OcclusionTargetReport {
  const worstOccluder = [...record.occluders.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    enemyId: record.enemyId,
    kind: record.kind,
    letter: record.letter,
    spawnedAt: roundSeconds(record.spawnedAt),
    removedAt: record.removedAt === null ? null : roundSeconds(record.removedAt),
    onscreenSeconds: roundSeconds(record.onscreenSeconds),
    occludedSeconds: roundSeconds(record.occludedSeconds),
    occludedRatio: record.onscreenSeconds > 0 ? roundRatio(record.occludedSeconds / record.onscreenSeconds) : 0,
    samples: record.samples,
    occludedSamples: record.occludedSamples,
    firstOccludedAt: record.firstOccludedAt === null ? null : roundSeconds(record.firstOccludedAt),
    worstOccluder,
  };
}

function labelObject(object: Object3D) {
  const names: string[] = [];
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node.name) names.push(node.name);
    if (node.userData.raildRole) names.push(String(node.userData.raildRole));
  }
  const label = names.slice(0, 3).join(' < ') || object.type || 'Object3D';
  return label.length > 80 ? `${label.slice(0, 77)}...` : label;
}

function readOptionPositiveNumber(value: number | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
  return value;
}

function readOptionNonNegativeNumber(value: number | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function readOptionPositiveInteger(value: number | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
function readOptionNonNegativeInteger(value: number | undefined, fallback: number, label: string) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}

function roundMillis(value: number) {
  return Math.round(value * 1000) / 1000;
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function max(values: number[]) {
  if (values.length === 0) return 0;
  let result = 0;
  for (const value of values) if (value > result) result = value;
  return result;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1))];
}

function readInPageHeapUsedMB() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  const bytes = memory?.usedJSHeapSize;
  return Number.isFinite(bytes) ? roundMillis((bytes as number) / (1024 * 1024)) : null;
}

function roundRatio(value: number) {
  return Math.round(value * 10000) / 10000;
}

function createSnapshotHud(): Hud {
  return {
    update: () => {},
    flashDamage: () => {},
    flashMaxLock: () => {},
    showEnd: () => {},
    hideEnd: () => {},
    setHudActive: () => {},
    setCallout: () => {},
    setTip: () => {},
    showTip: () => {},
    hideTip: () => {},
    setStartNudgesVisible: () => {},
    setSoundActive: () => {},
    isSoundActive: () => true,
    setFullscreenOffered: () => {},
  };
}

function hideProjectiles(root: Scene) {
  root.traverse((object) => {
    if (object.userData.raildRole === 'projectile') object.visible = false;
  });
}

function replaceSceneMaterials(root: Scene) {
  root.traverse((object) => {
    const renderable = object as RenderableObject;
    if (!renderable.material) return;
    renderable.material = Array.isArray(renderable.material)
      ? renderable.material.map((material) => createFallbackMaterial(material, renderable))
      : createFallbackMaterial(renderable.material, renderable);
  });
}

function createFallbackMaterial(source: Material, object: RenderableObject) {
  const sourceWithColor = source as Material & { color?: Color; size?: number; vertexColors?: boolean };
  const color = sourceWithColor.color instanceof Color ? sourceWithColor.color.clone() : new Color(0xffffff);
  const vertexColors = sourceWithColor.vertexColors === true;
  const common = {
    color,
    vertexColors,
    transparent: source.transparent,
    opacity: source.opacity,
    blending: source.blending,
    depthWrite: source.depthWrite,
    depthTest: source.depthTest,
    side: source.side,
  };

  if (object.isPoints) {
    return new PointsMaterial({
      ...common,
      size: Number.isFinite(sourceWithColor.size) ? sourceWithColor.size : 1,
      sizeAttenuation: true,
    });
  }

  if (object.isLine) return new LineBasicMaterial(common);
  return new MeshBasicMaterial(common);
}

function readFidelity(value: string | null): Fidelity {
  if (value === 'full' || value === 'postless' || value === 'flat') return value;
  return 'full';
}

function readBackend(value: string | null): Backend {
  if (value === 'webgl') return 'webgl';
  return 'webgpu';
}

/* three.js falls back to its WebGL2 backend without throwing when no WebGPU device is
   available, so what was asked for is not necessarily what is rendering. */
function readActiveBackend(value: SnapshotRenderer): Backend {
  const backend = (value as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
  return backend?.isWebGPUBackend === true ? 'webgpu' : 'webgl';
}

function readPositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readList(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function readBooleanOverride(value: string | null): boolean | undefined {
  if (value === null || value === '') return undefined;
  return value === '1' || value === 'true';
}

function readNonNegativeNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function measureLuminance(canvas: HTMLCanvasElement) {
  if (!SCRATCH_CONTEXT) return 0;
  SCRATCH_CANVAS.width = canvas.width;
  SCRATCH_CANVAS.height = canvas.height;
  SCRATCH_CONTEXT.drawImage(canvas, 0, 0);
  const { data } = SCRATCH_CONTEXT.getImageData(0, 0, SCRATCH_CANVAS.width, SCRATCH_CANVAS.height);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  return total / (data.length / 4);
}
