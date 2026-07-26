import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createTinkerGameplay, createTinkerRail, TINKER_BPM } from './gameplay';
import { TINKER_MARKERS, TINKER_RUN_SECTIONS, TINKER_TIME } from './timing';
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

export const tinkerBallLevel: LevelDefinition = {
  id: 'tinker-ball-nirz',
  title: 'Tinker Ball',
  description: 'A marble cleans up a cluttered worktable, and grows heavier with everything it rescues.',
  bpm: TINKER_BPM,
  markers: { ...TINKER_MARKERS },
  sections: TINKER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: TINKER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x140f0a,
    // Warm and restrained: the lamp should catch on wet glue and pin heads, not
    // wash the wood out. Everything here still reads with the slider at zero.
    bloom: { strength: 0.55, threshold: 0.62, radius: 0.35 },
    vignette: { inner: 0.34, outer: 1.05, strength: 0.62 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    const curve = createTinkerRail();
    createEnvironment(scene, curve);
    installVisualEventHandlers(bus, scene);

    // The spill narrates itself through the HUD; gameplay owns the fight.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('runstart', () => {
      calloutUntil = -1;
    });

    // A landed volley kicks the frame; taking a glue hit shakes the ball.
    bus.on('volley', ({ kills }) => {
      if (kills > 0) feel.kickFov(Math.min(4.5, 0.9 + kills * 0.6));
    });
    bus.on('playerhit', () => {
      feel.shake(0.55);
      feel.kickFov(-3.5);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') feel.shake(0.45);
      if (phase === 'destroyed') feel.shake(0.7);
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
      level: createTinkerGameplay(bus, say),
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
        feel.update(dt, { shake: { rollDegrees: 1.1, pitchDegrees: 0.4, yawDegrees: 0.32 } });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};

export default tinkerBallLevel;
