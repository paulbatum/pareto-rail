import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { VESPERS_C8VR_BPM } from './timing';
import { vespersC8vrGameplay } from './gameplay';
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

export const vespersC8vrLevel: LevelDefinition = {
  id: 'vespers-c8vr',
  title: 'Vespers',
  description: 'Fly the nave of a massive cathedral at night as black stone piers and vaulted arches flare with restored stained glass in polyphonic organ counterpoint.',
  bpm: VESPERS_C8VR_BPM,
  post: {
    clearColor: 0x030308,
    bloom: { strength: 0.65, threshold: 0.5, radius: 0.25 },
    vignette: { inner: 0.25, outer: 0.95, strength: 0.6 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const env = createEnvironment(scene);
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
      level: vespersC8vrGameplay,
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
        env.update(dt);
        game.update(dt);
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
