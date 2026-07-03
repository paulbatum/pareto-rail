import './style.css';
import { PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createAudio } from './audio';
import { events } from './events';
import { createGame } from './game/state';
import { createHud, showUnsupported } from './ui/hud';
import {
  createEnemyMesh,
  createEnvironment,
  createPost,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

async function bootstrap() {
  if (!('gpu' in navigator)) {
    showUnsupported('This game requires WebGPU');
    return;
  }

  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root');

  const renderer = new WebGPURenderer({ antialias: true, alpha: false });
  // three.js installs a WebGL fallback internally; this project is intentionally WebGPU-only.
  (renderer as WebGPURenderer & { _getFallback: null })._getFallback = null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x02040a, 1);

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
  const audio = createAudio(events);
  audio.installGestureStart();

  createEnvironment(scene);
  installVisualEventHandlers(events, scene);
  const post = createPost(renderer, scene, camera);

  const game = createGame({
    scene,
    camera,
    canvas: renderer.domElement,
    bus: events,
    hud,
    visuals: {
      createEnemyMesh,
      setEnemyLocked,
      createProjectileMesh,
      createReticle,
      setReticleActive,
    },
  });

  let last = performance.now();
  game.start();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    updateVisuals(dt, { scene, camera, elapsed: now / 1000 });
    post.render();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

void bootstrap();
