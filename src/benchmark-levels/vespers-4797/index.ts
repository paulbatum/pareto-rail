import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  VESPERS_4797_BPM,
  VESPERS_4797_MARKERS,
  VESPERS_4797_RUN_SECTIONS,
  createVespers4797Gameplay,
} from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const vespers4797Level: LevelDefinition = {
  id: 'vespers-4797',
  title: 'Vespers',
  description: 'A nocturnal rail flight through a cathedral where stained-glass light is being eaten from the inside.',
  bpm: VESPERS_4797_BPM,
  markers: { ...VESPERS_4797_MARKERS, bossEntrance: VESPERS_4797_MARKERS.roseWindow },
  sections: VESPERS_4797_RUN_SECTIONS,
  post: {
    clearColor: 0x010208,
    bloom: { strength: 0.62, threshold: 0.72, radius: 0.1 },
    vignette: { inner: 0.28, outer: 1.0, strength: 0.62 },
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
      level: createVespers4797Gameplay(bus),
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
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, dt, runProgress: game.runProgress });
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
