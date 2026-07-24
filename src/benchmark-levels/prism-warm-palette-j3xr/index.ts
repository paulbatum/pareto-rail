import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_WARM_PALETTE_J3XR_BPM, prismWarmPaletteJ3xrGameplay } from './gameplay';
import {
  PRISM_WARM_PALETTE_J3XR_ARRANGEMENT_SECTIONS,
  PRISM_WARM_PALETTE_J3XR_MARKERS,
  PRISM_WARM_PALETTE_J3XR_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const prismWarmPaletteJ3xrLevel: LevelDefinition = {
  id: 'prism-warm-palette-j3xr',
  title: 'Prism Warm Palette',
  description: 'A warm luminous prism flight through umber glass, amber sparks, coral comets, and cream-hot cores.',
  bpm: PRISM_WARM_PALETTE_J3XR_BPM,
  markers: PRISM_WARM_PALETTE_J3XR_MARKERS,
  sections: PRISM_WARM_PALETTE_J3XR_ARRANGEMENT_SECTIONS.map((section, index) => ({
    name: `${section.name}-${index < 5 ? 'first' : 'second'}`,
    time: PRISM_WARM_PALETTE_J3XR_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x260b08,
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
      level: prismWarmPaletteJ3xrGameplay,
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
