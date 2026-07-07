import {
  Color,
  LineBasicMaterial,
  Material,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointsMaterial,
  Scene,
  type Camera,
  type Object3D,
} from 'three';
import { WebGPURenderer, type WebGPURendererParameters } from 'three/webgpu';
import { createEventBus } from '../events';
import { createPost } from '../engine/post';
import type { Hud } from '../ui/hud';
import { getLevelById } from '../levels';
import type { LevelDefinition } from '../engine/types';

type Fidelity = 'full' | 'postless' | 'flat';

type GameplaySnapshotApi = {
  ready: Promise<void>;
  capture(): Promise<{ dataUrl: string; luminance: number; fidelity: Fidelity; state: string; seed: number | null }>;
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
  let elapsed = 0;
  while (elapsed < seconds - 0.000001) {
    const step = Math.min(dt, seconds - elapsed);
    elapsed += step;
    update(step, elapsed);
  }
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
