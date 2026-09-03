import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  TINKER_BALL_72PR_BPM,
  TINKER_BALL_72PR_MARKERS,
  TINKER_BALL_72PR_SECTIONS,
  TINKER_BALL_72PR_TIME,
  tinkerBall72prGameplay,
} from './gameplay';
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
} from './visuals';

export const tinkerBall72prLevel: LevelDefinition = {
  id: 'tinker-ball-72pr',
  title: 'Tinker Ball',
  description: 'A marble-to-melon cleanup run across a cluttered worktable, cracking glue monsters to rescue their stolen supplies.',
  bpm: TINKER_BALL_72PR_BPM,
  markers: { ...TINKER_BALL_72PR_MARKERS, spill: TINKER_BALL_72PR_MARKERS.boss },
  sections: TINKER_BALL_72PR_SECTIONS.map((section) => ({
    name: section.name,
    time: TINKER_BALL_72PR_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x0d0705,
    bloom: { strength: 0.45, threshold: 0.85, radius: 0.12 },
    vignette: { inner: 0.32, outer: 1.0, strength: 0.55 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE GLUE SPILL', 2.8);
      if (phase === 'exposed') say('CORE CRACKED', 2.2);
      if (phase === 'destroyed') say('SPILL CLEANED', 3.2);
    });
    bus.on('runstart', () => {
      calloutUntil = -1;
      say('CLEAN THE TABLE', 2.2);
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
      level: tinkerBall72prGameplay,
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
        now = elapsed;
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, feel, elapsed, runProgress: game.runProgress });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
