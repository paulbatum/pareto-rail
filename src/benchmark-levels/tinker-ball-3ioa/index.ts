import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createTinkerBallGameplay } from './gameplay';
import { resetSignals } from './signals';
import { MELON_TIME, TENNIS_TIME, TINKER_BPM, TINKER_MARKERS, TINKER_RUN_SECTIONS, TINKER_TIME } from './timing';
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
  setVisualDebug,
  updateCameraEffects,
  updateVisuals,
} from './visuals';
import { composeTinkerOutput } from './visuals/post-fx';

export const tinkerBallLevel: LevelDefinition = {
  id: 'tinker-ball-3ioa',
  title: 'Tinker Ball',
  description: 'Roll a marble across a cluttered worktable, break the glue creatures, and wear what they stole.',
  bpm: TINKER_BPM,
  markers: TINKER_MARKERS,
  sections: TINKER_RUN_SECTIONS.map((section) => ({ name: section.name, time: TINKER_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x0d0805,
    bloom: { strength: 0.7, threshold: 0.8, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.7 },
    composeOutput: composeTinkerOutput,
  },
  debugSelector: { queryParam: 'debugTinker', label: 'Debug', options: [{ id: 'debris', title: 'Debris on spawn' }] },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const feel = createCameraFeel(camera);
    setVisualDebug(debugValue);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    // Narration: the size steps and the Spill's beats get names. Gameplay
    // owns the fight; this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: TENNIS_TIME, text: 'TENNIS BALL', hold: 1.8 },
      { at: MELON_TIME, text: 'MELON', hold: 1.8 },
    ];
    let nextCallout = 0;
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE SPILL', 2.4);
      if (phase === 'exposed') say('THE HEART', 2.2);
      if (phase === 'destroyed') say('SPOTLESS', 3.0);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const gameplay = createTinkerBallGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: {
        ...gameplay,
        updateCameraEffects({ camera, runTime, runProgress, dt }) {
          updateCameraEffects(dt, { camera, runTime, runProgress, running: true, feel });
        },
        updateAttractCamera({ camera, dt }) {
          updateCameraEffects(dt, { camera, runTime: 0, runProgress: 0, running: false, feel });
        },
      },
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
        const running = game.state === 'running';
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
          elapsed,
          runTime,
          running: game.state === 'running',
          runProgress: game.runProgress,
          feel,
        });
      },
      dispose() {
        feel.dispose();
        game.dispose();
        disposeVisuals();
        resetSignals();
      },
    };
  },
};
