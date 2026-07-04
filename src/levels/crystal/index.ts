import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { crystalGameplay } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const crystalCorridorLevel: LevelDefinition = {
  id: 'crystal-corridor',
  title: 'Crystal Corridor',
  description: 'The original neon crystal rail run.',
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
      level: crystalGameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    return {
      update(dt, elapsed) {
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed });
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
