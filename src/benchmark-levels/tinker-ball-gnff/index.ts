import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { TINKER_BPM, createTinkerGameplay } from './gameplay';
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

export const tinkerBallGnffLevel: LevelDefinition = {
  id: 'tinker-ball-gnff',
  title: 'Tinker Ball',
  description: 'Roll the worktable clean: burst glue monsters, rescue their stolen supplies, and crack the Spill at the table\u2019s end.',
  bpm: TINKER_BPM,
  markers: TINKER_MARKERS,
  sections: TINKER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: TINKER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x160e08,
    bloom: { strength: 0.65, threshold: 0.62, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.05, strength: 0.62 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Act callouts: the ball's scale changes are the level's chapter marks.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: TINKER_TIME.bar(0, 2), text: 'MARBLE RUN', hold: 2.0 },
      { at: TINKER_TIME.bar(8), text: 'TENNIS-BALL SCALE', hold: 2.2 },
      { at: TINKER_TIME.bar(16), text: 'MELON SCALE', hold: 2.2 },
      { at: TINKER_TIME.bar(20, 3), text: 'THE SPILL', hold: 2.4 },
    ];
    let nextCallout = 0;
    let running = false;
    let runTime = 0;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('CORE EXPOSED', 2.4);
      if (phase === 'destroyed') say('SPOTLESS!', 3.2);
    });
    bus.on('runstart', () => {
      nextCallout = 0;
      calloutUntil = -1;
      running = true;
      runTime = 0;
    });
    bus.on('runend', () => {
      running = false;
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
      level: createTinkerGameplay(bus),
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
        if (running) {
          runTime += dt;
          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          runProgress: game.runProgress,
          running,
        });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
