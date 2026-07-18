import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { STRANDLINE_SI7K_BPM, strandlineSi7kGameplay } from './gameplay';
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

export const strandlineSi7kLevel: LevelDefinition = {
  id: 'strandline-si7k',
  title: 'Strandline',
  description: 'Freeing a gigantic jellyfish from an infestation. Glowing strands in sunlit blue-green water; sickly violet parasites cling and detach. Slow start, brightening through the run, a boss at the crown where strands root into the bell, then the whole animal in frame — clean, glowing, serene.',
  bpm: STRANDLINE_SI7K_BPM,
  post: {
    clearColor: 0x000000,
    bloom: { strength: 0.5, threshold: 0.7, radius: 0.1 },
    vignette: { inner: 0.3, outer: 1.0, strength: 0.5 },
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
      level: strandlineSi7kGameplay,
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
