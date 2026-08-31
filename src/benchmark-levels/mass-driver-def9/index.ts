import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverDef9Gameplay } from './gameplay';
import {
  MASS_DRIVER_DEF9_BARS,
  MASS_DRIVER_DEF9_BPM,
  MASS_DRIVER_DEF9_MARKERS,
  MASS_DRIVER_DEF9_RUN_SECTIONS,
  MASS_DRIVER_DEF9_TIME,
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
  updateCameraEffects,
  updateVisuals,
} from './visuals';

export const massDriverDef9Level: LevelDefinition = {
  id: 'mass-driver-def9',
  title: 'Mass Driver',
  description: 'Ride an accelerating orbital railgun, cut through its defense drones, and clear the jammed safeties before the firing charge peaks.',
  bpm: MASS_DRIVER_DEF9_BPM,
  markers: MASS_DRIVER_DEF9_MARKERS,
  sections: MASS_DRIVER_DEF9_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_DEF9_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x000107,
    bloom: { strength: 1.05, threshold: 0.62, radius: 0.18 },
    vignette: { inner: 0.31, outer: 1.08, strength: 0.72 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    const gameplay = createMassDriverDef9Gameplay(bus);
    createEnvironment(scene);
    installVisualEventHandlers(bus, camera, cameraFeel);

    let runTime = 0;
    let elapsedNow = 0;
    let nextCallout = 0;
    let calloutUntil = -1;
    let safetiesClear = false;

    const callouts = [
      { at: MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.induction), text: 'INDUCTION FIELD — LOCKED', hold: 2.0 },
      { at: MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.redline), text: 'REDLINE ACCELERATION', hold: 2.0 },
      { at: MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.interlocks) - 0.45, text: 'SAFETY BANK JAMMED — 17 SECONDS', hold: 3.0 },
      { at: MASS_DRIVER_DEF9_TIME.bar(28), text: 'FIRING CHARGE — 75%', hold: 1.8 },
      { at: MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.launch), text: '', hold: 2.0, launch: true },
      { at: MASS_DRIVER_DEF9_TIME.bar(MASS_DRIVER_DEF9_BARS.launch, 3), text: '', hold: 1.2, fire: true },
    ];

    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + hold;
    };

    bus.on('bossphase', ({ phase }) => {
      if (phase !== 'destroyed') return;
      safetiesClear = true;
      say('SAFETIES CLEAR — MUZZLE OPEN', 2.8);
    });

    bus.on('playerhit', ({ healthRemaining }) => {
      if (healthRemaining <= 0) say('CONTAINMENT FAILURE', 4);
    });

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      safetiesClear = false;
      hud.setCallout('');
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
        updateCameraEffects({ camera: activeCamera, runTime: activeRunTime, dt }) {
          updateCameraEffects(dt, {
            camera: activeCamera,
            runTime: activeRunTime,
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
        elapsedNow = elapsed;
        const runningBeforeUpdate = game.state === 'running';
        if (runningBeforeUpdate) {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout];
            const text = callout.launch
              ? safetiesClear ? 'FIRING SOLUTION — STAND BY' : 'CHARGE CRITICAL'
              : callout.fire
                ? safetiesClear ? 'MASS DRIVER — FIRE' : 'CHARGE PEAK'
                : callout.text;
            say(text, callout.hold);
            nextCallout += 1;
          }
        }

        if (calloutUntil >= 0 && elapsedNow >= calloutUntil) {
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
        game.dispose();
        cameraFeel.dispose();
        disposeVisuals();
      },
    };
  },
};
