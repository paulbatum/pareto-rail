import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_WARM_M7DZ_BPM, prismWarmM7dzGameplay } from './gameplay';
import { PRISM_WARM_M7DZ_MARKERS, PRISM_WARM_M7DZ_ARRANGEMENT_SECTIONS, PRISM_WARM_M7DZ_TIME } from './timing';
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

export const prismWarmM7dzLevel: LevelDefinition = {
  id: 'prism-warm-m7dz',
  title: 'Prism Ember',
  description: 'A warm luminous variant of the Prism Bloom rail shooter level.',
  bpm: PRISM_WARM_M7DZ_BPM,
  markers: PRISM_WARM_M7DZ_MARKERS,
  sections: PRISM_WARM_M7DZ_ARRANGEMENT_SECTIONS.map((section) => ({
    name: section.name,
    time: PRISM_WARM_M7DZ_TIME.bar(section.fromBar),
  })),
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
      level: prismWarmM7dzGameplay,
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