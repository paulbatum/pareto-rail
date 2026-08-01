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
import { PYRE_COLORS, PYRE_FAR_PLANE } from './visuals/world';

export const pyreLevel: LevelDefinition = {
  id: 'pyre',
  title: 'Pyre',
  description: 'A slow crawl across a frozen plain toward a burning block city under an overhead megastructure.',
  bpm: PYRE_BPM,
  // The vista runs kilometres out, well past the shared far plane. AgX is the
  // tone the level is authored under: emissives roll into filmic orange instead
  // of clipping, and the cold field keeps its depth.
  render: { farPlane: PYRE_FAR_PLANE, toneMapping: 'agx', exposure: 0.72 },
  post: {
    clearColor: PYRE_COLORS.sky,
    // Threshold above 1: only authored emissives (slits, molten field) bloom;
    // the pale ground must not, or the whole frame goes milky.
    bloom: { strength: 0.6, threshold: 1.05, radius: 0.22 },
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
