import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BROADSIDE_B2O2_BPM, broadsideB2o2Gameplay } from './gameplay';
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

export const broadsideB2o2Level: LevelDefinition = {
  id: 'broadside-b2o2',
  title: 'Broadside',
  description: 'TODO: replace this scaffold description.',
  bpm: BROADSIDE_B2O2_BPM,
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
      level: broadsideB2o2Gameplay,
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
