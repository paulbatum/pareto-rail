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

type Fidelity = 'full' | 'postless' | 'flat';

type GameplaySnapshotApi = {
  ready: Promise<void>;
  capture(): Promise<{ dataUrl: string; luminance: number; fidelity: Fidelity; state: string }>;
};

type SnapshotRenderer = WebGPURenderer & {
  domElement: HTMLCanvasElement;
  render(scene: Scene, camera: Camera): void;
};

type SnapshotRendererParameters = WebGPURendererParameters & {
  forceWebGL: true;
  preserveDrawingBuffer: true;
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

let renderer: SnapshotRenderer | null = null;
let post: PostRenderer | null = null;
let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
let runtimeState = 'unknown';

window.__raildDebug = {
  ...window.__raildDebug,
  immortal: params.get('immortal') === '1',
};

window.__gameplaySnapshot = {
  ready: bootstrap(),
  async capture() {
    if (!renderer || !scene || !camera) throw new Error('Gameplay snapshot renderer is not ready');
    if (post) post.render();
    else renderer.render(scene, camera);
    const luminance = measureLuminance(renderer.domElement);
    return {
      dataUrl: renderer.domElement.toDataURL('image/png'),
      luminance,
      fidelity,
      state: runtimeState,
    };
  },
};

async function bootstrap() {
  const selectedLevel = getLevelById(params.get('level'));
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
  document.body.append(renderer.domElement);

  const bus = createEventBus();
  runtimeState = 'attract';
  bus.on('runstart', () => {
    runtimeState = 'running';
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

  if (fidelity === 'flat') replaceSceneMaterials(scene);
  if (fidelity === 'full') post = createPost(renderer, scene, camera, selectedLevel.post);
}

function startRunViaInput() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
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
