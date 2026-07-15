import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { PRISM_WARM_T2QX_BPM, prismWarmT2qxGameplay } from './gameplay';
import { PRISM_WARM_T2QX_MARKERS, PRISM_WARM_T2QX_ARRANGEMENT_SECTIONS, PRISM_WARM_T2QX_TIME } from './timing';
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

export const prismWarmT2qxLevel: LevelDefinition = {
  id: 'prism-bloom',
  title: 'Prism Ember',
  description: 'A warm luminous prism rail through umber space, with amber and coral targets blooming to a gold lock cadence.',
  bpm: PRISM_WARM_T2QX_BPM,
  markers: PRISM_WARM_T2QX_MARKERS,
  sections: PRISM_WARM_T2QX_ARRANGEMENT_SECTIONS.map((section) => ({
    name: section.name,
    time: PRISM_WARM_T2QX_TIME.bar(section.fromBar),
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
      level: prismWarmT2qxGameplay,
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
