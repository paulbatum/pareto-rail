import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  BROADSIDE_61Z2_BPM,
  BROADSIDE_61Z2_MARKERS,
  BROADSIDE_61Z2_RUN_SECTIONS,
  BROADSIDE_61Z2_TIME,
} from './timing';
import { createBroadside61z2Gameplay } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const broadside61z2Level: LevelDefinition = {
  id: 'broadside-61z2',
  title: 'Broadside',
  description: 'Launch from your flagship deck, fly the fleet crossfire, and cut through an enemy flagship from shield skin to exposed core.',
  bpm: BROADSIDE_61Z2_BPM,
  markers: BROADSIDE_61Z2_MARKERS,
  sections: BROADSIDE_61Z2_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_61Z2_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x04000f,
    bloom: { strength: 0.92, threshold: 0.62, radius: 0.14 },
    vignette: { inner: 0.32, outer: 1.04, strength: 0.68 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, camera, cameraFeel);
    const gameplay = createBroadside61z2Gameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: gameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    let runTime = 0;
    let elapsedNow = 0;
    bus.on('runstart', () => {
      runTime = 0;
    });

    return {
      update(dt, elapsed) {
        elapsedNow = elapsed;
        game.update(dt);
        if (game.state === 'running') runTime += dt;
        updateVisuals(dt, { scene, camera, elapsed: elapsedNow, runTime, running: game.state === 'running' });
        const pressure = game.state === 'running' ? Math.min(1.9, runTime / 28) : 0;
        cameraFeel.setFovOffset(pressure * 1.8);
        cameraFeel.update(dt, {
          shake: { pitchDegrees: 0.34, yawDegrees: 0.28, rollDegrees: 0.95, frequency: 10.5 },
        });
      },
      dispose() {
        game.dispose();
        disposeVisuals(scene, camera);
        cameraFeel.dispose();
      },
    };
  },
};
