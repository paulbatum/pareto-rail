import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_WARM_W9KA_BPM, prismWarmW9kaGameplay } from './gameplay';
import { PRISM_WARM_W9KA_MARKERS, PRISM_WARM_W9KA_ARRANGEMENT_SECTIONS, PRISM_WARM_W9KA_TIME } from './timing';
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

export const prismWarmW9kaLevel: LevelDefinition = {
  id: 'prism-warm-w9ka',
  title: 'Prism Ember',
  description: 'A separate glassy level with its own rail, targets, visual language, and soundtrack.',
  bpm: PRISM_WARM_W9KA_BPM,
  markers: PRISM_WARM_W9KA_MARKERS,
  sections: PRISM_WARM_W9KA_ARRANGEMENT_SECTIONS.map((section) => ({
    name: section.name,
    time: PRISM_WARM_W9KA_TIME.bar(section.fromBar),
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
      level: prismWarmW9kaGameplay,
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
