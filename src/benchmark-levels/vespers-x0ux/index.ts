import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  VESPERS_X0UX_BPM,
  VESPERS_X0UX_MARKERS,
  createVespersGameplay,
} from './gameplay';
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

export const vespersX0uxLevel: LevelDefinition = {
  id: 'vespers-x0ux',
  title: 'Vespers',
  description: 'A dark cathedral rail run where stolen stained-glass light returns one pane at a time, ending at a rose window that can turn the whole nave bright.',
  bpm: VESPERS_X0UX_BPM,
  markers: VESPERS_X0UX_MARKERS,
  sections: [
    { name: 'Nave', time: 0 },
    { name: 'Arcade', time: VESPERS_X0UX_MARKERS.arcade },
    { name: 'Dead span', time: VESPERS_X0UX_MARKERS.silence },
    { name: 'West approach', time: VESPERS_X0UX_MARKERS.approach },
    { name: 'Rose window', time: VESPERS_X0UX_MARKERS.roseEntrance },
    { name: 'Lit cathedral', time: VESPERS_X0UX_MARKERS.finale },
  ],
  post: {
    clearColor: 0x010108,
    bloom: { strength: 0.66, threshold: 0.72, radius: 0.12 },
    vignette: { inner: 0.25, outer: 1.0, strength: 0.62 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    const game = createVespersGameplay(bus);
    const runner = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: game,
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
        runner.update(dt);
        updateVisuals(dt, camera, elapsed, runner.runProgress);
      },
      dispose() {
        runner.dispose();
        disposeVisuals();
      },
    };
  },
};
