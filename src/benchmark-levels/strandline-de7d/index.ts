import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { STRANDLINE_DE7D_BPM, strandlineDe7dGameplay } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
} from './visuals';

export const strandlineDe7dLevel: LevelDefinition = {
  id: 'strandline-de7d',
  title: 'Strandline',
  description: 'A sunlit underwater world of glowing strands — freeing a giant jellyfish from violet parasites.',
  bpm: STRANDLINE_DE7D_BPM,
  post: {
    clearColor: 0x001a33,
    bloom: { strength: 0.7, threshold: 0.6, radius: 0.15 },
    vignette: { inner: 0.35, outer: 1.0, strength: 0.55 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: strandlineDe7dGameplay,
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
      update(dt) {
        game.update(dt);
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
