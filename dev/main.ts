import './style.css';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGPURenderer } from 'three/webgpu';
import { createPost, getBloomLevel, setBloomLevel } from '../src/engine/post';
import { createCrystal, defaultCrystalTemplate, type CrystalKind, type CrystalColorRole, type CrystalTemplate, type NumericRange } from '../src/levels/crystal/visuals/crystal';

const KINDS: CrystalKind[] = ['node', 'drifter', 'orbiter'];
const GRID_COUNT = 12;
const GRID_COLUMNS = 3;
const WEIGHT_SLIDER_MAX = 18;

let selectedKind: CrystalKind = 'node';
let selectedSeed = 0;
let savedTemplate = clone(defaultCrystalTemplate);
let editedTemplate = clone(defaultCrystalTemplate);
let gallery: RenderView | null = null;
let inspect: RenderView | null = null;
let inspectControls: OrbitControls | null = null;
let inspectUserControlled = false;
let galleryRoot = new Group();
let inspectRoot = new Group();
let galleryCrystals: Group[] = [];
let inspectCrystal: Group | null = null;
let selectionRing: Mesh | null = null;

const app = document.querySelector<HTMLDivElement>('#dev-app');
if (!app) throw new Error('Missing #dev-app');

app.innerHTML = `
  <header class="topbar">
    <div>
      <p class="eyebrow">Pareto Rail dev tool</p>
      <h1>Enemy gallery</h1>
    </div>
    <div id="save-status" class="status">Unsaved edits stay in this page until saved.</div>
  </header>
  <main class="shell">
    <aside class="panel">
      <section class="picker card">
        <label>Template
          <select id="template-select"><option value="crystal">crystal</option></select>
        </label>
        <label>Kind
          <select id="kind-select"></select>
        </label>
        <label class="bloom-control">Bloom
          <span class="bloom-slider"><input id="bloom-slider" type="range" min="0" max="150" step="1" value="100" /><output id="bloom-readout">100%</output></span>
        </label>
        <div class="actions">
          <button id="reset-button" type="button">Reset to saved</button>
          <button id="save-button" type="button" class="primary">Save</button>
        </div>
      </section>
      <section id="controls" class="controls"></section>
    </aside>
    <section class="views">
      <div class="card view-card gallery-card">
        <div class="view-title"><h2>Gallery grid</h2><span>Click a crystal to inspect its stable seed.</span></div>
        <div id="gallery-view" class="canvas-host"></div>
      </div>
      <div class="card view-card inspect-card">
        <div class="view-title"><h2>Inspect view</h2><span id="inspect-label">seed 0</span></div>
        <div id="inspect-view" class="canvas-host"></div>
      </div>
    </section>
  </main>
`;

const controlsEl = mustGet<HTMLDivElement>('controls');
const statusEl = mustGet<HTMLDivElement>('save-status');
const kindSelect = mustGet<HTMLSelectElement>('kind-select');
const resetButton = mustGet<HTMLButtonElement>('reset-button');
const saveButton = mustGet<HTMLButtonElement>('save-button');
const bloomSlider = mustGet<HTMLInputElement>('bloom-slider');
const bloomReadout = mustGet<HTMLOutputElement>('bloom-readout');
const inspectLabel = mustGet<HTMLSpanElement>('inspect-label');

for (const kind of KINDS) {
  const option = document.createElement('option');
  option.value = kind;
  option.textContent = kind;
  kindSelect.append(option);
}
kindSelect.value = selectedKind;
bloomSlider.value = `${Math.round(getBloomLevel() * 100)}`;
bloomReadout.value = `${bloomSlider.value}%`;
bloomSlider.addEventListener('input', () => {
  const value = bloomSlider.valueAsNumber;
  setBloomLevel(value / 100);
  bloomReadout.value = `${Math.round(value)}%`;
});
kindSelect.addEventListener('change', () => {
  selectedKind = kindSelect.value as CrystalKind;
  renderControls();
  regenerateGallery();
  setStatus(`Editing ${selectedKind}.`, '');
});

resetButton.addEventListener('click', () => {
  void resetToSaved();
});
saveButton.addEventListener('click', () => {
  void saveTemplate();
});

void bootstrap();

async function bootstrap() {
  if (!('gpu' in navigator)) {
    setStatus('This page requires WebGPU.', 'error');
    return;
  }

  renderControls();

  try {
    gallery = await createRenderView(mustGet<HTMLDivElement>('gallery-view'), 40);
    inspect = await createRenderView(mustGet<HTMLDivElement>('inspect-view'), 55);
  } catch (error) {
    console.error(error);
    setStatus('WebGPU initialization failed.', 'error');
    return;
  }

  gallery.scene.add(galleryRoot);
  inspect.scene.add(inspectRoot);
  inspect.camera.position.set(0, 0, 5.2);
  inspectControls = new OrbitControls(inspect.camera, inspect.renderer.domElement);
  inspectControls.enableDamping = true;
  inspectControls.dampingFactor = 0.08;
  inspectControls.minDistance = 2;
  inspectControls.maxDistance = 10;
  inspectControls.addEventListener('start', () => {
    inspectUserControlled = true;
  });

  installGalleryPicking(gallery);
  regenerateGallery();
  animate();
}

function renderControls() {
  controlsEl.replaceChildren();
  addHexControls();
  addSpokeControls();
  addShardControls();
  addFinControls();
  addCoreControls();
  addKindControls();
}

function addHexControls() {
  const body = addDetails('Hex frames');
  editedTemplate.shared.hexRings.forEach((ring, index) => {
    const defaults = savedTemplate.shared.hexRings[index] ?? ring;
    const group = document.createElement('fieldset');
    group.innerHTML = `<legend>Ring ${index + 1}</legend>`;
    addNumber(group, 'radius', ring.radius, defaults.radius, (value) => (ring.radius = value));
    addNumber(group, 'z offset', ring.zOffset, defaults.zOffset, (value) => (ring.zOffset = value), { signed: true });
    addNumber(group, 'intensity', ring.intensity, defaults.intensity, (value) => (ring.intensity = value));
    addNumber(group, 'spin offset', ring.spinOffset, defaults.spinOffset, (value) => (ring.spinOffset = value), {
      min: 0,
      max: Math.PI * 2,
      step: 0.001,
    });
    const label = document.createElement('label');
    label.className = 'control-row select-row';
    label.innerHTML = '<span>color role</span>';
    const select = document.createElement('select');
    for (const role of ['accent', 'contrast'] satisfies CrystalColorRole[]) {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = role;
      select.append(option);
    }
    select.value = ring.colorRole;
    select.addEventListener('change', () => {
      ring.colorRole = select.value as CrystalColorRole;
      regenerateGallery();
    });
    label.append(select);
    group.append(label);
    body.append(group);
  });
}

function addSpokeControls() {
  const body = addDetails('Spokes');
  const spokes = editedTemplate.shared.spokes;
  const defaults = savedTemplate.shared.spokes;
  addNumber(body, 'count', spokes.count, defaults.count, (value) => (spokes.count = value), { integer: true, min: 0 });
  addNumber(body, 'radius', spokes.radius, defaults.radius, (value) => (spokes.radius = value));
  addNumber(body, 'length', spokes.length, defaults.length, (value) => (spokes.length = value));
  addNumber(body, 'center distance', spokes.centerDistance, defaults.centerDistance, (value) => (spokes.centerDistance = value));
  addNumber(body, 'fill intensity', spokes.fillIntensity, defaults.fillIntensity, (value) => (spokes.fillIntensity = value));
  addNumber(body, 'edge intensity', spokes.edgeIntensity, defaults.edgeIntensity, (value) => (spokes.edgeIntensity = value));
}

function addShardControls() {
  const body = addDetails('Shards');
  const shards = editedTemplate.shared.shards;
  const defaults = savedTemplate.shared.shards;
  addNumber(body, 'base radius', shards.baseRadius, defaults.baseRadius, (value) => (shards.baseRadius = value));
  addRange(body, 'scale x', shards.scale.x, defaults.scale.x);
  addRange(body, 'scale y', shards.scale.y, defaults.scale.y);
  addRange(body, 'scale z', shards.scale.z, defaults.scale.z);
  addNumber(body, 'x bias scale', shards.xBiasScale, defaults.xBiasScale, (value) => (shards.xBiasScale = value));
  addNumber(body, 'x bias offset', shards.xBiasOffset, defaults.xBiasOffset, (value) => (shards.xBiasOffset = value));
  addRange(body, 'distance multiplier', shards.distanceMult, defaults.distanceMult);
  addNumber(body, 'flatten', shards.flatten, defaults.flatten, (value) => (shards.flatten = value));
  addNumber(body, 'tilt jitter', shards.tiltJitter, defaults.tiltJitter, (value) => (shards.tiltJitter = value));
  addNumber(body, 'fill intensity', shards.fillIntensity, defaults.fillIntensity, (value) => (shards.fillIntensity = value));
  addNumber(body, 'edge intensity', shards.edgeIntensity, defaults.edgeIntensity, (value) => (shards.edgeIntensity = value));
}

function addFinControls() {
  const body = addDetails('Fins');
  const fins = editedTemplate.shared.fins;
  const defaults = savedTemplate.shared.fins;
  addNumber(body, 'angle spread', fins.angleSpread, defaults.angleSpread, (value) => (fins.angleSpread = value));
  addNumber(body, 'z tilt', fins.zTilt, defaults.zTilt, (value) => (fins.zTilt = value));
  addRange(body, 'length multiplier', fins.lengthMult, defaults.lengthMult);
  addRange(body, 'base width', fins.baseWidth, defaults.baseWidth);
  addNumber(body, 'tip width', fins.tipWidth, defaults.tipWidth, (value) => (fins.tipWidth = value));
  addRange(body, 'base distance multiplier', fins.baseDistanceMult, defaults.baseDistanceMult);
  addNumber(body, 'fill intensity', fins.fillIntensity, defaults.fillIntensity, (value) => (fins.fillIntensity = value));
  addNumber(body, 'edge intensity', fins.edgeIntensity, defaults.edgeIntensity, (value) => (fins.edgeIntensity = value));
}

function addCoreControls() {
  const body = addDetails('Core');
  const core = editedTemplate.shared.core;
  const defaults = savedTemplate.shared.core;
  addNumber(body, 'core radius', core.coreRadius, defaults.coreRadius, (value) => (core.coreRadius = value));
  addNumber(body, 'glow radius', core.glowRadius, defaults.glowRadius, (value) => (core.glowRadius = value));
  addNumber(body, 'core intensity', core.coreIntensity, defaults.coreIntensity, (value) => (core.coreIntensity = value));
  addNumber(body, 'glow intensity', core.glowIntensity, defaults.glowIntensity, (value) => (core.glowIntensity = value));
  addNumber(body, 'glow opacity', core.glowOpacity, defaults.glowOpacity, (value) => (core.glowOpacity = value), { min: 0, max: 1 });
}

function addKindControls() {
  const body = addDetails('Kind');
  const kind = editedTemplate.kinds[selectedKind];
  const defaults = savedTemplate.kinds[selectedKind];
  addNumber(body, 'cyan weight', kind.weights[0], defaults.weights[0], (value) => (kind.weights[0] = value), { max: WEIGHT_SLIDER_MAX });
  addNumber(body, 'magenta weight', kind.weights[1], defaults.weights[1], (value) => (kind.weights[1] = value), { max: WEIGHT_SLIDER_MAX });
  addNumber(body, 'amber weight', kind.weights[2], defaults.weights[2], (value) => (kind.weights[2] = value), { max: WEIGHT_SLIDER_MAX });
  addNumber(body, 'shard pairs', kind.shardPairs, defaults.shardPairs, (value) => (kind.shardPairs = value), { integer: true, min: 0 });
  addNumber(body, 'fin pairs', kind.finPairs, defaults.finPairs, (value) => (kind.finPairs = value), { integer: true, min: 0 });
  addNumber(body, 'shell radius', kind.shellRadius, defaults.shellRadius, (value) => (kind.shellRadius = value));
  addNumber(body, 'elongation', kind.elongation, defaults.elongation, (value) => (kind.elongation = value));
}

function addDetails(title: string) {
  const details = document.createElement('details');
  details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = title;
  const body = document.createElement('div');
  body.className = 'details-body';
  details.append(summary, body);
  controlsEl.append(details);
  return body;
}

type NumberOptions = {
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  signed?: boolean;
};

function addNumber(
  parent: HTMLElement,
  labelText: string,
  value: number,
  defaultValue: number,
  setValue: (value: number) => void,
  options: NumberOptions = {},
) {
  const label = document.createElement('label');
  label.className = 'control-row';
  const name = document.createElement('span');
  name.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'range';
  const [min, max] = numberBounds(defaultValue, options);
  input.min = `${min}`;
  input.max = `${max}`;
  input.step = `${options.step ?? (options.integer ? 1 : 0.001)}`;
  input.value = `${clamp(value, min, max)}`;
  const readout = document.createElement('output');
  readout.value = formatNumber(value, options.integer);
  input.addEventListener('input', () => {
    const next = options.integer ? Math.round(input.valueAsNumber) : input.valueAsNumber;
    setValue(next);
    input.value = `${next}`;
    readout.value = formatNumber(next, options.integer);
    regenerateGallery();
  });
  label.append(name, input, readout);
  parent.append(label);
}

function addRange(parent: HTMLElement, labelText: string, range: NumericRange, defaultRange: NumericRange) {
  const row = document.createElement('div');
  row.className = 'range-control';
  const title = document.createElement('div');
  title.className = 'range-title';
  title.textContent = labelText;
  const [minBound, maxBound] = rangeBounds(defaultRange);
  const minInput = makeRangeInput(minBound, maxBound, range[0]);
  const maxInput = makeRangeInput(minBound, maxBound, range[1]);
  const readout = document.createElement('output');
  const sync = () => {
    let minValue = minInput.valueAsNumber;
    let maxValue = maxInput.valueAsNumber;
    if (minValue > maxValue) {
      if (document.activeElement === minInput) maxValue = minValue;
      else minValue = maxValue;
    }
    range[0] = minValue;
    range[1] = maxValue;
    minInput.value = `${minValue}`;
    maxInput.value = `${maxValue}`;
    readout.value = `${formatNumber(minValue)} – ${formatNumber(maxValue)}`;
    regenerateGallery();
  };
  minInput.addEventListener('input', sync);
  maxInput.addEventListener('input', sync);
  readout.value = `${formatNumber(range[0])} – ${formatNumber(range[1])}`;
  row.append(title, minInput, maxInput, readout);
  parent.append(row);
}

function makeRangeInput(min: number, max: number, value: number) {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = `${min}`;
  input.max = `${max}`;
  input.step = '0.001';
  input.value = `${clamp(value, min, max)}`;
  return input;
}

function numberBounds(defaultValue: number, options: NumberOptions): [number, number] {
  if (options.min !== undefined || options.max !== undefined) {
    return [options.min ?? 0, options.max ?? Math.max(1, defaultValue * 3)];
  }
  if (options.signed) {
    const extent = Math.max(Math.abs(defaultValue) * 3, 0.25);
    return [-extent, extent];
  }
  return [0, Math.max(defaultValue * 3, 1)];
}

function rangeBounds(defaultRange: NumericRange): [number, number] {
  const low = Math.min(defaultRange[0], defaultRange[1]);
  const high = Math.max(defaultRange[0], defaultRange[1]);
  return [Math.min(0, low), Math.max(high * 3, 1)];
}

function regenerateGallery() {
  if (!gallery || !inspect) return;
  for (const crystal of galleryCrystals) disposeObject(crystal);
  if (selectionRing) disposeObject(selectionRing);
  galleryRoot.clear();
  galleryCrystals = [];

  selectionRing = makeSelectionRing();
  galleryRoot.add(selectionRing);

  const rows = Math.ceil(GRID_COUNT / GRID_COLUMNS);
  for (let seed = 0; seed < GRID_COUNT; seed += 1) {
    const crystal = createCrystal(selectedKind, { seed, template: editedTemplate });
    const col = seed % GRID_COLUMNS;
    const row = Math.floor(seed / GRID_COLUMNS);
    crystal.position.set((col - (GRID_COLUMNS - 1) / 2) * 2.55, ((rows - 1) / 2 - row) * 2.325, 0);
    crystal.scale.setScalar(0.52);
    crystal.userData.gallerySeed = seed;
    galleryRoot.add(crystal);
    galleryCrystals.push(crystal);
  }

  gallery.camera.position.set(0, 0, 13.5);
  gallery.camera.lookAt(0, 0, 0);
  gallery.camera.updateProjectionMatrix();
  updateSelectionRing();
  regenerateInspect();
}

function regenerateInspect() {
  if (!inspect) return;
  if (inspectCrystal) disposeObject(inspectCrystal);
  inspectRoot.clear();
  inspectCrystal = createCrystal(selectedKind, { seed: selectedSeed, template: editedTemplate });
  inspectCrystal.scale.setScalar(1.55);
  inspectRoot.add(inspectCrystal);
  inspectLabel.textContent = `${selectedKind}, seed ${selectedSeed}`;
}

function updateSelectionRing() {
  if (!selectionRing) return;
  const selected = galleryCrystals.find((crystal) => crystal.userData.gallerySeed === selectedSeed);
  if (!selected) return;
  selectionRing.position.copy(selected.position);
  selectionRing.visible = true;
}

function makeSelectionRing() {
  const ring = new Mesh(
    new RingGeometry(1.02, 1.08, 48),
    new MeshBasicMaterial({
      color: new Color(0.8, 0.2, 1.8),
      side: DoubleSide,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  ring.position.z = 0.08;
  return ring;
}

function installGalleryPicking(view: RenderView) {
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  view.renderer.domElement.addEventListener('click', (event) => {
    const rect = view.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, view.camera);
    const hits = raycaster.intersectObjects(galleryCrystals, true);
    const crystal = hits.length > 0 ? findGalleryRoot(hits[0].object) : null;
    if (!crystal) return;
    selectedSeed = crystal.userData.gallerySeed as number;
    updateSelectionRing();
    regenerateInspect();
  });
}

function findGalleryRoot(object: Object3D): Group | null {
  let current: Object3D | null = object;
  while (current) {
    if (typeof current.userData.gallerySeed === 'number') return current as Group;
    current = current.parent;
  }
  return null;
}

type RenderView = {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  post: ReturnType<typeof createPost>;
};

async function createRenderView(host: HTMLElement, fov: number): Promise<RenderView> {
  const renderer = new WebGPURenderer({ antialias: true, alpha: false });
  (renderer as WebGPURenderer & { _getFallback: null })._getFallback = null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x02040a, 1);
  host.append(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(fov, 1, 0.1, 100);
  resizeRenderer(renderer, camera, host);
  await renderer.init();
  const post = createPost(renderer, scene, camera);
  const resize = () => resizeRenderer(renderer, camera, host);
  new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize);
  return { renderer, scene, camera, post };
}

function resizeRenderer(renderer: WebGPURenderer, camera: PerspectiveCamera, host: HTMLElement) {
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now() / 1000;
  for (const crystal of galleryCrystals) {
    crystal.rotation.set(Math.sin(now * 0.35) * 0.12, now * 0.45, Math.sin(now * 0.2) * 0.08);
  }
  if (selectionRing) selectionRing.rotation.z = now * -0.9;
  if (inspectCrystal && !inspectUserControlled) inspectCrystal.rotation.y += 0.002;
  inspectControls?.update();
  gallery?.post.render();
  inspect?.post.render();
}

async function resetToSaved() {
  try {
    const response = await fetch(`/src/levels/crystal/visuals/crystal-template.json?cache=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    savedTemplate = (await response.json()) as CrystalTemplate;
    editedTemplate = clone(savedTemplate);
    renderControls();
    regenerateGallery();
    setStatus('Reloaded the last-saved template from disk.', 'ok');
  } catch (error) {
    console.error(error);
    setStatus('Could not reload the saved template.', 'error');
  }
}

async function saveTemplate() {
  saveButton.disabled = true;
  setStatus('Saving…', '');
  try {
    const response = await fetch('/dev/api/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editedTemplate),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    savedTemplate = clone(editedTemplate);
    renderControls();
    setStatus('Saved to src/levels/crystal/visuals/crystal-template.json.', 'ok');
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? `Save failed: ${error.message}` : 'Save failed.', 'error');
  } finally {
    saveButton.disabled = false;
  }
}

function setStatus(message: string, tone: '' | 'ok' | 'error') {
  statusEl.textContent = message;
  statusEl.className = `status ${tone}`;
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    const maybeMesh = child as Mesh;
    maybeMesh.geometry?.dispose();
    const material = maybeMesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else {
      material?.dispose();
    }
  });
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number, integer = false) {
  return integer ? `${Math.round(value)}` : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
