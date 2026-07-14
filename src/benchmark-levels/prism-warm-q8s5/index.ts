import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_WARM_Q8S5_BPM, prismWarmQ8s5Gameplay } from './gameplay';
import { PRISM_WARM_Q8S5_MARKERS, PRISM_WARM_Q8S5_ARRANGEMENT_SECTIONS, PRISM_WARM_Q8S5_TIME } from './timing';
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

export const prismWarmQ8s5Level: LevelDefinition = {
  id: 'prism-warm-q8s5',
  title: 'Prism Ember',
  description: 'A warm luminous prism rail with fan waves, procedural bloom, and a compact melodic score.',
  bpm: PRISM_WARM_Q8S5_BPM,
  markers: PRISM_WARM_Q8S5_MARKERS,
  sections: PRISM_WARM_Q8S5_ARRANGEMENT_SECTIONS.map((section) => ({
    name: section.name,
    time: PRISM_WARM_Q8S5_TIME.bar(section.fromBar),
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
      level: prismWarmQ8s5Gameplay,
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
