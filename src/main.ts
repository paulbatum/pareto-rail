import './style.css';
import { PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createEventBus } from './events';
import { createPost, getBloomLevel, setBloomLevel } from './engine/post';
import { getLevelById, selectableLevels } from './levels';
import { getStartScreenTip } from './ui/client-tip';
import { installDevErrorOverlay } from './ui/dev-error-overlay';
import { createHud, showUnsupported } from './ui/hud';
import { createPauseMenu } from './ui/pause';

async function bootstrap() {
  if (import.meta.env.DEV) installDevErrorOverlay();
  if (!('gpu' in navigator)) {
    showUnsupported('This game requires WebGPU');
    return;
  }

  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root');

  const urlParams = new URLSearchParams(window.location.search);
  const selectedLevel = getLevelById(urlParams.get('level'));
  const debugValue = selectedLevel.debugSelector ? urlParams.get(selectedLevel.debugSelector.queryParam) ?? undefined : undefined;
  document.title = `raild — ${selectedLevel.title}`;
  installLevelPicker(selectedLevel.id, import.meta.env.DEV);
  installDebugPicker(selectedLevel, urlParams);

  const renderer = new WebGPURenderer({ antialias: true, alpha: false });
  // three.js installs a WebGL fallback internally; this project is intentionally WebGPU-only.
  (renderer as WebGPURenderer & { _getFallback: null })._getFallback = null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(selectedLevel.post?.clearColor ?? 0x02040a, 1);

  try {
    await renderer.init();
  } catch (error) {
    console.error(error);
    showUnsupported('This game requires WebGPU');
    return;
  }

  app.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);
  const hud = createHud();
  const bus = createEventBus();
  const audio = selectedLevel.createAudio(bus);
  audio.setMasterVolume(readStoredPercent('raild-volume', 50) / 100);
  setBloomLevel(readStoredPercent('raild-bloom', 100) / 100);
  audio.installGestureStart();

  const post = createPost(renderer, scene, camera, selectedLevel.post);

  let paused = false;
  let last = performance.now();
  let setPaused = (_paused: boolean) => {};
  const fullscreenAvailable = canUseFullscreen();
  const togglePause = () => setPaused(!paused);
  const toggleFullscreen = () => {
    if (!fullscreenAvailable) return;
    void setFullscreen(!document.fullscreenElement);
  };

  const pauseMenu = createPauseMenu({
    fullscreenAvailable,
    initialVolume: audio.getMasterVolume() * 100,
    initialBloom: getBloomLevel() * 100,
    onResume: () => setPaused(false),
    onFullscreen: toggleFullscreen,
    onVolume: (value) => {
      localStorage.setItem('raild-volume', `${value}`);
      audio.setMasterVolume(value / 100);
    },
    onBloom: (value) => {
      localStorage.setItem('raild-bloom', `${value}`);
      setBloomLevel(value / 100);
    },
  });

  setPaused = (nextPaused: boolean) => {
    paused = nextPaused;
    pauseMenu.setPaused(paused);
    if (paused) void audio.suspend();
    else void audio.start();
    last = performance.now();
  };

  const runtime = selectedLevel.createRuntime({
    scene,
    camera,
    canvas: renderer.domElement,
    bus,
    hud,
    onPause: togglePause,
    onFullscreen: toggleFullscreen,
    startTip: getStartScreenTip(fullscreenAvailable),
    debugValue,
  });

  document.body.classList.remove('booting');

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) runtime.update(dt, now / 1000);
    post.render();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener('pagehide', () => {
    runtime.dispose();
    audio.dispose();
    bus.clear();
  });
}

function installLevelPicker(activeId: string, includeDebug: boolean) {
  const host = document.createElement('label');
  host.className = 'level-picker';
  host.textContent = 'Level ';
  const select = document.createElement('select');
  for (const level of selectableLevels(includeDebug)) {
    const option = document.createElement('option');
    option.value = level.id;
    option.textContent = level.title;
    option.selected = level.id === activeId;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('level', select.value);
    window.location.href = url.toString();
  });
  host.append(select);
  document.body.append(host);
}

function installDebugPicker(level: ReturnType<typeof getLevelById>, urlParams: URLSearchParams) {
  const selector = level.debugSelector;
  if (!selector) return;

  const host = document.createElement('label');
  host.className = 'level-picker debug-picker';
  host.textContent = `${selector.label} `;
  const select = document.createElement('select');
  const activeValue = urlParams.get(selector.queryParam) ?? selector.options[0]?.id;
  for (const optionDefinition of selector.options) {
    const option = document.createElement('option');
    option.value = optionDefinition.id;
    option.textContent = optionDefinition.title;
    option.selected = optionDefinition.id === activeValue;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('level', level.id);
    url.searchParams.set(selector.queryParam, select.value);
    window.location.href = url.toString();
  });
  host.append(select);
  document.body.append(host);
}

function canUseFullscreen() {
  return Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
}

async function setFullscreen(enabled: boolean) {
  try {
    if (enabled) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch (error) {
    console.warn('Fullscreen request failed', error);
  }
}

function readStoredPercent(key: string, fallback: number) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const stored = Number(raw);
  if (!Number.isFinite(stored)) return fallback;
  return Math.min(100, Math.max(0, stored));
}

void bootstrap();
