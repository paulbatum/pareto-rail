import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_BPM, prismGameplay } from './gameplay';
import { PRISM_MARKERS, PRISM_ARRANGEMENT_SECTIONS, PRISM_TIME } from './timing';
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
  disposeEnvironment,
} from './visuals';

export const prismWarmPaletteT9mvLevel: LevelDefinition = {
  id: 'prism-warm-palette-t9mv',
  title: 'Prism Warm Palette',
  description: 'A warm luminous prism rail where amber, coral, cream, and gold targets bloom through a deep umber corridor.',
  bpm: PRISM_BPM,
  markers: PRISM_MARKERS,
  sections: PRISM_ARRANGEMENT_SECTIONS.map((section) => ({
    name: section.name,
    time: PRISM_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x260b0d,
    bloom: { strength: 0.5, threshold: 0.7, radius: 0.1 },
    vignette: { inner: 0.3, outer: 1.0, strength: 0.5 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    const feel = createCameraFeel(camera);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: prismGameplay,
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
        updateVisuals(dt, { scene, camera, feel, elapsed, runProgress: game.runProgress });
        feel.update(dt);
      },
      dispose() {
        game.dispose();
        feel.dispose();
        disposeEnvironment();
      },
    };
  },
};
