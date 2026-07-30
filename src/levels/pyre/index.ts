import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { PYRE_BPM, pyreGameplay } from './gameplay';
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
import { PYRE_COLORS } from './visuals/composition';

export const pyreLevel: LevelDefinition = {
  id: 'pyre',
  title: 'Pyre',
  description: 'A slow crawl across a frozen plain toward a burning block city under an overhead megastructure.',
  bpm: PYRE_BPM,
  // Blockout stage: flat value-matched placeholder colours, so bloom and
  // vignette stay off and the massing is judged on its own.
  post: {
    clearColor: PYRE_COLORS.sky,
    bloom: { strength: 0, threshold: 1, radius: 0.1 },
    vignette: false,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const environment = createEnvironment(scene);
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
      level: pyreGameplay,
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
        environment.dispose();
      },
    };
  },
};
