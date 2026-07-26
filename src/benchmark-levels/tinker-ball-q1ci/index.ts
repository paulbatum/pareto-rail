import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createTinkerBallQ1ciGameplay } from './gameplay';
import {
  TINKER_BALL_Q1CI_BPM,
  TINKER_BALL_Q1CI_MARKERS,
  TINKER_BALL_Q1CI_RUN_SECTIONS,
  TINKER_BALL_Q1CI_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const tinkerBallQ1ciLevel: LevelDefinition = {
  id: 'tinker-ball-q1ci',
  title: 'Tinker Ball',
  description: 'Roll through a lamp-lit worktable, break the glue monsters, and wear every rescued supply.',
  bpm: TINKER_BALL_Q1CI_BPM,
  markers: { ...TINKER_BALL_Q1CI_MARKERS, boss: TINKER_BALL_Q1CI_MARKERS.spillEntrance },
  sections: TINKER_BALL_Q1CI_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: TINKER_BALL_Q1CI_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x21121b,
    bloom: { strength: 0.32, threshold: 1.05, radius: 0.14 },
    vignette: { inner: 0.28, outer: 0.96, strength: 0.48 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    const uninstallVisualHandlers = installVisualEventHandlers(bus, scene);

    let now = 0;
    let runStartedAt = -1;
    let nextScaleCallout = 0;
    let calloutUntil = -1;
    const scaleMoments = [
      { time: 0, text: 'MARBLE SIZE' },
      { time: TINKER_BALL_Q1CI_MARKERS.spoolParade, text: 'TENNIS-BALL SIZE' },
      { time: TINKER_BALL_Q1CI_MARKERS.heavyLifting, text: 'MELON SIZE' },
    ];
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = now + seconds;
    };

    const offRunStart = bus.on('runstart', () => {
      runStartedAt = now;
      nextScaleCallout = 0;
      calloutUntil = -1;
    });
    const offBossPhase = bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE GLUE SPILL', 2.3);
      if (phase === 'exposed') say('HEART EXPOSED', 2.2);
      if (phase === 'destroyed') say('CLEAN SWEEP!', 3.4);
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
      level: createTinkerBallQ1ciGameplay(bus),
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
        game.update(dt);
        if (game.state === 'running' && runStartedAt >= 0) {
          const runTime = elapsed - runStartedAt;
          const moment = scaleMoments[nextScaleCallout];
          if (moment && runTime >= moment.time) {
            say(moment.text, 1.65);
            nextScaleCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          hud.setCallout('');
          calloutUntil = -1;
        }
        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          runProgress: game.runProgress,
        });
        feel.update(dt);
      },
      dispose() {
        offRunStart();
        offBossPhase();
        uninstallVisualHandlers();
        game.dispose();
        disposeVisuals();
        feel.dispose();
      },
    };
  },
};
