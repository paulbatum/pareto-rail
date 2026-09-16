import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { TINKER_BALL_X9A0_BPM, tinkerBallX9a0Gameplay, TIME } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateDenied,
} from './visuals';

export const tinkerBallX9a0Level: LevelDefinition = {
  id: 'tinker-ball-x9a0',
  title: 'Tinker Ball',
  description: 'A tiny rolling collector dismantles glue creatures across a warm, oversized worktable. Rescue supplies, grow a lopsided ball, and crack the recycling spill.',
  bpm: TINKER_BALL_X9A0_BPM,
  markers: {
    bossShell1: TIME.bar(22),
    bossShell2: TIME.bar(25),
    bossShell3: TIME.bar(28),
    finale: TIME.bar(30),
  },
  sections: [
    { name: 'Marble / button dance', time: TIME.bar(0) },
    { name: 'Tennis ball / peg-bird chorus', time: TIME.bar(8) },
    { name: 'Melon / recycled glue shells', time: TIME.bar(22) },
    { name: 'Clean tabletop / cadence', time: TIME.bar(28) },
  ],
  post: {
    clearColor: 0x695249,
    bloom: { strength: 0.18, threshold: 1.1, radius: 0.1 },
    vignette: { inner: 0.45, outer: 1.1, strength: 0.2 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    const effects = installVisualEventHandlers(bus, scene, camera);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: { ...tinkerBallX9a0Gameplay, detailsForRun: effects.details },
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
        game.update(dt);
        effects.update(dt);
        updateDenied(dt);
      },
      dispose() {
        effects.dispose();
        game.dispose();
      },
    };
  },
};
