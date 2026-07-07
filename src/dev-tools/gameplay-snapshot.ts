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
import { collectPerfCounters, type PerfCounters } from '../engine/perf-counters';
import type { Hud } from '../ui/hud';
import { getLevelById } from '../levels';
import type { LevelDefinition } from '../engine/types';

type Fidelity = 'full' | 'postless' | 'flat';

type OcclusionOptions = {
  dt?: number;
  sampleStep?: number;
  threshold?: number;
  minOnscreenSamples?: number;
  minOccludedSeconds?: number;
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
  dt: number;
  elapsed: number;
  targets: OcclusionTargetReport[];
  warnings: OcclusionTargetReport[];
};

type PerfStepOptions = {
  dt?: number;
  targetTime: number;
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
  capture(): Promise<{ dataUrl: string; luminance: number; fidelity: Fidelity; state: string; seed: number | null }>;
  analyzeOcclusion(options?: OcclusionOptions): Promise<OcclusionReport>;
  stepPerformance(options: PerfStepOptions): Promise<PerfStepSample>;
  metadata(): {
    duration: number | null;
    fidelity: Fidelity;
    state: string;
    bpm: number | null;
    markers: Record<string, number>;
    sections: Array<{ name: string; time: number }>;
  };
};

type SnapshotRenderer = WebGPURenderer & {
  domElement: HTMLCanvasElement;
  info?: { reset?: () => void };
  render(scene: Scene, camera: Camera): void;
};

type SnapshotRendererParameters = WebGPURendererParameters & {
  forceWebGL: true;
  preserveDrawingBuffer: true;
};

type SnapshotRendererInternals = SnapshotRenderer & {
  _animation?: { stop(): void };
  _nodes?: {
    nodeFrame?: {
      time: number;
      deltaTime: number;
      frameId: number;
      lastTime?: number;
    };
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
const showProjectiles = params.get('projectiles') === '1';

let renderer: SnapshotRenderer | null = null;
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
    if (post) post.render();
    else renderer.render(scene, camera);
    const luminance = measureLuminance(renderer.domElement);
    return {
      dataUrl: renderer.domElement.toDataURL('image/png'),
      luminance,
      fidelity,
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
  metadata() {
    return {
      duration: runDuration,
      fidelity,
      state: runtimeState,
      bpm: selectedLevel ? selectedLevel.bpm : null,
      markers: selectedLevel ? (selectedLevel.markers ?? {}) : {},
      sections: selectedLevel ? (selectedLevel.sections ?? []) : [],
    };
  },
};

async function bootstrap() {
  selectedLevel = await getLevelById(params.get('level'));
  document.title = `raild gameplay snapshot — ${selectedLevel.title}`;

  scene = new Scene();
  camera = new PerspectiveCamera(62, width / height, 0.1, 500);

  const rendererParams = {
    antialias: true,
    alpha: false,
    forceWebGL: true,
    preserveDrawingBuffer: true,
  } as SnapshotRendererParameters;
  renderer = new WebGPURenderer(rendererParams) as SnapshotRenderer;
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(selectedLevel.post?.clearColor ?? 0x02040a, 1);
  await renderer.init();
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
    canvas: renderer.domElement,
    bus,
    hud: createSnapshotHud(),
    onPause: () => {},
    onFullscreen: () => {},
    startTip: '',
    debugValue: params.get('debugValue') ?? undefined,
  });

  runtimeUpdate = runtime.update;
  startRunViaInput();
  advanceRuntime(runtime.update, targetTime, fixedDt);

  if (!showProjectiles) hideProjectiles(scene);
  if (fidelity === 'flat') replaceSceneMaterials(scene);
  if (fidelity === 'full') post = createPost(renderer, scene, camera, selectedLevel.post);
}

function startRunViaInput() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
}

function stopRendererAnimation(value: SnapshotRenderer) {
  (value as SnapshotRendererInternals)._animation?.stop();
}

function setRendererFrameTime(value: SnapshotRenderer, seconds: number, dt: number) {
  const nodeFrame = (value as SnapshotRendererInternals)._nodes?.nodeFrame;
  if (!nodeFrame) return;
  nodeFrame.time = seconds;
  nodeFrame.deltaTime = dt;
  nodeFrame.frameId = Math.round(seconds / dt);
  nodeFrame.lastTime = 0;
}

function advanceRuntime(update: (dt: number, elapsed: number) => void, seconds: number, dt: number) {
  while (currentElapsed < seconds - 0.000001) {
    const step = Math.min(dt, seconds - currentElapsed);
    currentElapsed += step;
    update(step, currentElapsed);
  }
}

async function stepPerformance(options: PerfStepOptions): Promise<PerfStepSample> {
  if (!scene || !camera || !renderer || !runtimeUpdate) throw new Error('Gameplay snapshot runtime is not ready');
  const dt = readOptionPositiveNumber(options.dt, fixedDt, 'dt');
  const targetTime = readOptionNonNegativeNumber(options.targetTime, currentElapsed, 'targetTime');
  const frameTimes: number[] = [];

  while (currentElapsed < targetTime - 0.000001 && runtimeState !== 'ended') {
    const step = Math.min(dt, targetTime - currentElapsed);
    const before = performance.now();
    currentElapsed += step;
    runtimeUpdate(step, currentElapsed);
    setRendererFrameTime(renderer, currentElapsed, step);
    renderer.info?.reset?.();
    if (post) post.render();
    else renderer.render(scene, camera);
    frameTimes.push(performance.now() - before);
  }

  if (frameTimes.length === 0) {
    setRendererFrameTime(renderer, currentElapsed, dt);
    renderer.info?.reset?.();
    if (post) post.render();
    else renderer.render(scene, camera);
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

async function analyzeTargetOcclusion(options: OcclusionOptions): Promise<OcclusionReport> {
  if (!scene || !camera || !runtimeUpdate || !selectedLevel) throw new Error('Gameplay snapshot runtime is not ready');
  if (currentElapsed > 0.001) throw new Error('Occlusion analysis must start from a fresh page at time=0');

  const dt = readOptionPositiveNumber(options.dt, fixedDt, 'dt');
  const sampleStep = readOptionPositiveNumber(options.sampleStep, 0.1, 'sampleStep');
  const threshold = readOptionNonNegativeNumber(options.threshold, 0.05, 'threshold');
  const minOnscreenSamples = readOptionPositiveInteger(options.minOnscreenSamples, 3, 'minOnscreenSamples');
  const minOccludedSeconds = readOptionNonNegativeNumber(options.minOccludedSeconds, sampleStep, 'minOccludedSeconds');
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

  return {
    level: { id: selectedLevel.id, title: selectedLevel.title, duration: runDuration },
    threshold,
    sampleStep,
    dt,
    elapsed: roundSeconds(currentElapsed),
    targets,
    warnings,
  };
}

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

  const ndc = targetNdc(candidates[0]);
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

function readPositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
