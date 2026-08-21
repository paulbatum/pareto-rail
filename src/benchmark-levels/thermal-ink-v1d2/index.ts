import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  createThermalInkV1d2Gameplay,
  DIVE_TIME,
  ENGAGE_TIME,
  THERMAL_INK_V1D2_BPM,
  THERMAL_INK_V1D2_DURATION,
} from './gameplay';
import {
  THERMAL_INK_V1D2_MARKERS,
  THERMAL_INK_V1D2_RUN_SECTIONS,
  THERMAL_INK_V1D2_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironmentInternal,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateThermalInkCameraEffects,
  updateVisuals,
} from './visuals';
import { composeThermalInkOutput } from './visuals/post-fx';

export const thermalInkV1d2Level: LevelDefinition = {
  id: 'thermal-ink-v1d2',
  title: 'Thermal Ink',
  description: 'One continuous fight against a giant octopus in a drowned harbor. Its ink swallows sight — fly through, let the thermal display snap in, and strike through the dark.',
  bpm: THERMAL_INK_V1D2_BPM,
  markers: THERMAL_INK_V1D2_MARKERS,
  sections: THERMAL_INK_V1D2_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: THERMAL_INK_V1D2_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x0c0803,
    bloom: { strength: 1.05, threshold: 0.55, radius: 0.18 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.72 },
    composeOutput: composeThermalInkOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironmentInternal(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the run's set pieces get names. Gameplay owns the fight.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.4, text: 'THE HARBOR DROWNED', hold: 2.2 },
      { at: ENGAGE_TIME - 0.3, text: 'IT SEES YOU', hold: 2.4 },
      { at: DIVE_TIME - 0.3, text: 'BELOW THE ARMS', hold: 2.2 },
      { at: THERMAL_INK_V1D2_DURATION + 10, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;
    // The final wall follows the core exposure, so its callout is event-driven.
    let blackoutCalloutAt = -1;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') {
        say('CORE EXPOSED', 2.2);
        blackoutCalloutAt = now + 3.0;
      }
      if (phase === 'destroyed') say('THE HARBOR GOES QUIET', 3.5);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      blackoutCalloutAt = -1;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const thermalInkV1d2Gameplay = createThermalInkV1d2Gameplay(bus);

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
        ...thermalInkV1d2Gameplay,
        updateCameraEffects(context) {
          updateThermalInkCameraEffects(context.dt, {
            camera: context.camera,
            runTime: context.runTime,
            running: true,
            feel: cameraFeel,
          });
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
          while (nextCallout < timedCallouts.length - 1 && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
          }
          if (blackoutCalloutAt > 0 && elapsed >= blackoutCalloutAt) {
            blackoutCalloutAt = -1;
            say('FINAL BLACKOUT', 2.4);
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
          feel: cameraFeel,
        });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
