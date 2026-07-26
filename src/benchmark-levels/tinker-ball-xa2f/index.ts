import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { TINKER_BALL_XA2F_BPM, tinkerBallXa2fGameplay } from './gameplay';
import { TINKER_BALL_XA2F_MARKERS, TINKER_BALL_XA2F_SECTIONS, TINKER_BALL_XA2F_TIME } from './timing';
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

export const tinkerBallXa2fLevel: LevelDefinition = {
  id: 'tinker-ball-xa2f',
  title: 'Tinker Ball',
  description:
    'Roll across an oversized worktable as a marble, gathering stolen stationery and clean supplies while battling dark adhesive glue monsters.',
  bpm: TINKER_BALL_XA2F_BPM,
  markers: TINKER_BALL_XA2F_MARKERS,
  sections: TINKER_BALL_XA2F_SECTIONS.map((s) => ({
    name: s.name,
    time: TINKER_BALL_XA2F_TIME.bar(s.fromBar),
  })),
  post: {
    clearColor: 0x140c1b,
    bloom: { strength: 0.45, threshold: 0.7, radius: 0.12 },
    vignette: { inner: 0.35, outer: 0.95, strength: 0.45 },
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
      if (phase === 'summoned') say('GLUE SPILL WARDEN', 2.8);
      if (phase === 'exposed') say('ADHESIVE CORE EXPOSED', 2.8);
      if (phase === 'destroyed') say('TABLE SPOTLESS & CLEAN!', 3.2);
    });

    bus.on('runstart', () => {
      calloutUntil = -1;
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
      level: tinkerBallXa2fGameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    const rail = tinkerBallXa2fGameplay.createRail();
    let prevRailPos = rail.getPointAt(0);

    return {
      update(dt, elapsed) {
        now = elapsed;
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }

        game.update(dt);

        // Determine ball scale radius based on run progress:
        // Act 1 (0-15s / progress < 0.25): Marble (0.35)
        // Act 2 (15-30s / progress < 0.50): Tennis ball (0.70)
        // Act 3 (30-60s / progress >= 0.50): Melon (1.10)
        const progress = game.runProgress;
        let ballScaleRadius = 0.35;
        if (progress >= 0.5) ballScaleRadius = 1.1;
        else if (progress >= 0.25) ballScaleRadius = 0.7;

        const currentRailPos = rail.getPointAt(Math.min(1, Math.max(0, progress)));
        // Offset ball slightly below camera to seat on table rail
        const ballPos = currentRailPos.clone();
        ballPos.y -= 0.6;

        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          runProgress: progress,
          railPosition: ballPos,
          prevRailPosition: prevRailPos,
          ballScaleRadius,
        });

        prevRailPos.copy(ballPos);
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
