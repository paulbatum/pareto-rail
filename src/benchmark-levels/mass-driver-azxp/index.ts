import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay } from './gameplay';
import { runState } from './run-state';
import {
  BEAT,
  CHARGE_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_SECTIONS,
  MASS_DRIVER_TIME,
  STAGE_ONE_TIME,
  STAGE_TWO_TIME,
  bar,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  SPACE_BLACK,
  updateAttractCamera,
  updateCameraEffects,
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverAzxpLevel: LevelDefinition = {
  id: 'mass-driver-azxp',
  title: 'Mass Driver',
  description: 'Ride a payload down an orbital railgun — one coil per beat — and blow the jammed safeties before the charge peaks.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_SECTIONS.map((section) => ({ name: section.name, time: MASS_DRIVER_TIME.bar(section.fromBar) })),
  debugSelector: {
    queryParam: 'safeties',
    label: 'Safeties',
    options: [
      { id: 'jammed', title: 'Jammed (normal run)' },
      { id: 'clear', title: 'Auto-clear (inspect the launch)' },
    ],
  },
  post: {
    clearColor: SPACE_BLACK,
    bloom: { strength: 0.85, threshold: 0.7, radius: 0.18 },
    vignette: { inner: 0.36, outer: 1.12, strength: 0.72 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    // Gameplay subscribes first so its charge bookkeeping is current when the
    // visuals and narration hear the same events.
    const gameplay = createMassDriverGameplay(bus, { autoClearSafeties: debugValue === 'clear' });
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, camera, feel);

    // ---- beat phase ------------------------------------------------------------------
    // The transport starts a fraction of a second after the run does. Measure
    // where the heard beats land in run time so every coil is crossed on one.
    let runTime = 0;
    let running = false;
    let phaseSamples = 0;
    let outliers = 0;
    bus.on('beat', ({ beatNumber }) => {
      if (!running) return;
      const measured = runTime - beatNumber * BEAT;
      if (phaseSamples === 0 || outliers >= 3) {
        runState.beatPhase = measured;
        outliers = 0;
      } else if (Math.abs(measured - runState.beatPhase) > 0.25) {
        outliers += 1; // a pause or hitch; ignore unless it persists
        return;
      } else {
        runState.beatPhase += (measured - runState.beatPhase) * 0.2;
      }
      phaseSamples += 1;
    });

    // ---- narration -------------------------------------------------------------------
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timed = [
      { at: STAGE_ONE_TIME, text: 'STAGE ONE', hold: 1.4 },
      { at: STAGE_TWO_TIME, text: 'STAGE TWO', hold: 1.4 },
      { at: CHARGE_TIME, text: 'FINAL CHARGE — SAFETIES JAMMED', hold: 2.6 },
      { at: bar(26), text: 'CHARGE CRITICAL', hold: 1.8, unlessClear: true },
    ];
    let nextTimed = 0;
    let interlocksSeen = 0;
    let interlocksDown = 0;
    let announcedClear = false;
    bus.on('runstart', () => {
      runTime = 0;
      running = true;
      phaseSamples = 0;
      outliers = 0;
      runState.beatPhase = 0;
      nextTimed = 0;
      interlocksSeen = 0;
      interlocksDown = 0;
      announcedClear = false;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('spawn', ({ kind }) => {
      if (kind === 'interlock') interlocksSeen += 1;
      if (kind === 'discharge' && runState.outcome === 'breach') say('BARREL BREACH', 3);
      if (kind === 'discharge' && runState.outcome === 'launch') {
        // Out of the muzzle, everything goes quiet — including the HUD.
        hud.setCallout('');
        calloutUntil = -1;
      }
    });
    bus.on('kill', () => {
      if (runState.interlocksDestroyed > interlocksDown) {
        interlocksDown = runState.interlocksDestroyed;
        if (runState.outcome === 'launch' && !announcedClear) {
          announcedClear = true;
          say('SAFETIES CLEAR — FIRING', 2.4);
        } else if (interlocksSeen > 0) {
          say(`SAFETY ${interlocksDown} OF 6 BLOWN`, 1.1);
        }
      }
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
      level: {
        ...gameplay,
        updateCameraEffects({ camera: cam, runTime: time, dt }) {
          updateCameraEffects(dt, cam, time, feel);
        },
        updateAttractCamera({ camera: cam, modeTime }) {
          updateAttractCamera(cam, modeTime);
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
        if (game.state === 'running') {
          runTime += dt;
          while (nextTimed < timed.length && runTime >= timed[nextTimed].at) {
            const callout = timed[nextTimed];
            if (!(callout.unlessClear && runState.outcome === 'launch')) say(callout.text, callout.hold);
            nextTimed += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { camera, elapsed, runTime, running: game.state === 'running', feel });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
