import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  createTinkerBall8bf3Gameplay,
  TINKER_BALL_8BF3_BPM,
  TINKER_BALL_8BF3_RUN_DURATION,
  TINKER_BALL_8BF3_SECTIONS,
  TINKER_BALL_8BF3_TIME,
} from './gameplay';
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

export const tinkerBall8bf3Level: LevelDefinition = {
  id: 'tinker-ball-8bf3',
  title: 'Tinker Ball',
  description: 'Roll a growing marble through a cluttered worktable, dismantling glue creatures piece by piece.',
  bpm: TINKER_BALL_8BF3_BPM,
  markers: {
    drawer: TINKER_BALL_8BF3_TIME.bar(8),
    sprint: TINKER_BALL_8BF3_TIME.bar(16),
    spill: TINKER_BALL_8BF3_TIME.bar(24),
    cleanPatch: TINKER_BALL_8BF3_TIME.bar(31),
  },
  sections: TINKER_BALL_8BF3_SECTIONS.map((section) => ({
    name: section.name,
    time: TINKER_BALL_8BF3_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x050107,
    bloom: { strength: 0.82, threshold: 0.68, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.62 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    bus.on('fire', ({ volleySize }) => {
      feel.kickFov(0.25 + volleySize * 0.08, { decay: 6.5 });
      if (volleySize >= 4) feel.shake(0.045 + volleySize * 0.008, { decay: 3.8, frequency: 11 });
    });
    bus.on('kill', ({ scoreAwarded }) => {
      feel.kickFov(scoreAwarded > 400 ? 0.7 : 0.16, { decay: scoreAwarded > 400 ? 3.2 : 7.5 });
      if (scoreAwarded > 400) feel.shake(0.08, { decay: 3.1, frequency: 8 });
    });

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: createTinkerBall8bf3Gameplay(bus),
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
        updateVisuals(dt, { scene, camera, elapsed, runProgress: game.runProgress });
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

export { TINKER_BALL_8BF3_RUN_DURATION };

