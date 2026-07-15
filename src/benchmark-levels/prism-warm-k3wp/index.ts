import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_WARM_K3WP_BPM, prismWarmK3wpGameplay } from './gameplay';
import { PRISM_WARM_K3WP_MARKERS, PRISM_WARM_K3WP_ARRANGEMENT_SECTIONS, PRISM_WARM_K3WP_TIME } from './timing';
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

export const prismWarmK3wpLevel: LevelDefinition = {
  id: 'prism-warm-k3wp',
  title: 'Prism Ember',
  description: 'A warm ember prism rail through a luminous umber corridor.',
  bpm: PRISM_WARM_K3WP_BPM,
  markers: PRISM_WARM_K3WP_MARKERS,
  sections: PRISM_WARM_K3WP_ARRANGEMENT_SECTIONS.map((section) => ({
    name: section.name,
    time: PRISM_WARM_K3WP_TIME.bar(section.fromBar),
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
      level: prismWarmK3wpGameplay,
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
