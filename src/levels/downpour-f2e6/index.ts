import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createDownpourGameplay, DOWNPOUR_BPM } from './gameplay';
import { composeDownpourOutput } from './visuals/post-fx';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects,
  updateVisuals,
} from './visuals';

export const downpourF2e6Level: LevelDefinition = {
  id: 'downpour-f2e6',
  title: 'Downpour',
  description: 'Ride a hunted courier drone through a rain-lashed neon megacity, one storm-lit plunge at a time.',
  bpm: DOWNPOUR_BPM,
  post: {
    clearColor: 0x01020a,
    bloom: { strength: 0.95, threshold: 0.55, radius: 0.22 },
    vignette: { inner: 0.32, outer: 1.05, strength: 0.7 },
    composeOutput: composeDownpourOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    let runTime = 0;
    bus.on('runstart', () => {
      runTime = 0;
    });

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: {
        ...createDownpourGameplay(bus),
        updateCameraEffects({ camera, runTime: t, dt }) {
          updateCameraEffects(dt, { camera, runTime: t, running: true, feel: cameraFeel });
        },
      },
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    return {
      update(dt, elapsed) {
        const running = game.state === 'running';
        if (running) runTime += dt;
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running, feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
