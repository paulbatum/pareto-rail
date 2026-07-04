import {
  Box3,
  Color,
  Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
} from 'three';
import { WebGPURenderer, type WebGPURendererParameters } from 'three/webgpu';
import { createPost } from '../engine/post';

type SnapshotApi = {
  ready: Promise<void>;
  capture(yawDeg: number, pitchDeg: number): Promise<string>;
  luminance(): number;
};

type SnapshotRenderer = WebGPURenderer & {
  domElement: HTMLCanvasElement;
  render(scene: Scene, camera: PerspectiveCamera): void;
};

type SnapshotRendererParameters = WebGPURendererParameters & {
  preserveDrawingBuffer: true;
};

type PostRenderer = ReturnType<typeof createPost>;

declare global {
  interface Window {
    __snapshot: SnapshotApi;
  }
}

const BACKGROUND = 0x05060a;
const DEFAULT_SIZE = 800;
const FILL_FRACTION = 0.7;
const DEFAULT_PITCH_DEG = -12;
const SCRATCH_CANVAS = document.createElement('canvas');
const SCRATCH_CONTEXT = SCRATCH_CANVAS.getContext('2d', { willReadFrequently: true });

const params = new URLSearchParams(window.location.search);
const size = readPositiveNumber(params.get('size')) ?? DEFAULT_SIZE;
const bloomEnabled = params.get('bloom') !== '0';

const scene = new Scene();
scene.background = new Color(BACKGROUND);
const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
const orbit = {
  center: new Vector3(),
  radius: 10,
};

let post: PostRenderer | null = null;
let renderer: SnapshotRenderer | null = null;
let lastLuminance = 0;

window.__snapshot = {
  ready: bootstrap(),
  async capture(yawDeg: number, pitchDeg: number = DEFAULT_PITCH_DEG) {
    if (!renderer) throw new Error('Snapshot renderer is not ready');
    positionCamera(yawDeg, pitchDeg);
    renderFrame();
    lastLuminance = measureLuminance(renderer.domElement);
    return renderer.domElement.toDataURL('image/png');
  },
  luminance() {
    return lastLuminance;
  },
};

async function bootstrap() {
  const modulePath = params.get('module');
  const exportName = params.get('export');
  if (!modulePath) throw new Error('Missing required query param: module');
  if (!exportName) throw new Error('Missing required query param: export');

  const rendererParams = {
    antialias: true,
    alpha: false,
    forceWebGL: true,
    preserveDrawingBuffer: true,
  } as SnapshotRendererParameters;
  renderer = new WebGPURenderer(rendererParams) as SnapshotRenderer;
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(BACKGROUND, 1);
  await renderer.init();
  document.body.append(renderer.domElement);

  const object = await createSnapshotObject(modulePath, exportName, readArgs(params.get('args')));
  normalizeRootScale(object);
  scene.add(object);
  frameObject(object);
  positionCamera(0, DEFAULT_PITCH_DEG);

  if (bloomEnabled) post = createPost(renderer, scene, camera);
  renderFrame();
  lastLuminance = measureLuminance(renderer.domElement);
}

async function createSnapshotObject(modulePath: string, exportName: string, args: unknown[]): Promise<Object3D> {
  const moduleUrl = toModuleUrl(modulePath);
  const imported = (await import(/* @vite-ignore */ moduleUrl)) as Record<string, unknown>;
  const factory = imported[exportName];
  if (typeof factory !== 'function') throw new Error(`Export ${JSON.stringify(exportName)} is not a function in ${modulePath}`);

  const result = (factory as (...factoryArgs: unknown[]) => unknown)(...args);
  if (!(result instanceof Object3D)) throw new Error(`Export ${JSON.stringify(exportName)} did not return a three.js Object3D`);
  return result;
}

function toModuleUrl(modulePath: string) {
  const trimmed = modulePath.trim().replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('\0') || trimmed.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new Error(`Invalid module path: ${modulePath}`);
  }
  return `/${trimmed}`;
}

function readArgs(value: string | null): unknown[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('args must be a JSON array');
  return parsed;
}

function readPositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRootScale(object: Object3D) {
  const maxScale = Math.max(Math.abs(object.scale.x), Math.abs(object.scale.y), Math.abs(object.scale.z));
  if (maxScale > 0 && maxScale < 0.01) object.scale.setScalar(1);
}

function frameObject(object: Object3D) {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) {
    orbit.center.set(0, 0, 0);
    orbit.radius = 8;
  } else {
    const sphere = box.getBoundingSphere(new Sphere());
    orbit.center.copy(sphere.center);
    const objectRadius = Math.max(sphere.radius, 0.5);
    const visibleHalfAngle = (camera.fov * Math.PI) / 360;
    orbit.radius = objectRadius / (Math.sin(visibleHalfAngle) * FILL_FRACTION);
  }

  camera.near = Math.max(0.01, orbit.radius / 200);
  camera.far = Math.max(100, orbit.radius * 20);
  camera.updateProjectionMatrix();
}

function positionCamera(yawDeg: number, pitchDeg: number) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const horizontal = Math.cos(pitch) * orbit.radius;
  camera.position.set(
    orbit.center.x + Math.sin(yaw) * horizontal,
    orbit.center.y + Math.sin(pitch) * orbit.radius,
    orbit.center.z + Math.cos(yaw) * horizontal,
  );
  camera.lookAt(orbit.center);
  camera.updateMatrixWorld();
}

function renderFrame() {
  if (!renderer) throw new Error('Snapshot renderer is not ready');
  if (post) post.render();
  else renderer.render(scene, camera);
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
