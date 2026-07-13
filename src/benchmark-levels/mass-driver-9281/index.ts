import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriver9281Gameplay } from './gameplay';
import {
  MASS_DRIVER_9281_BPM,
  MASS_DRIVER_9281_MARKERS,
  MASS_DRIVER_9281_RUN_SECTIONS,
  MASS_DRIVER_9281_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setChargeFailure,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const massDriver9281Level: LevelDefinition = {
  id: 'mass-driver-9281',
  title: 'Mass Driver',
  description: 'Ride a payload through a beat-locked orbital railgun and clear its jammed safeties before the firing charge peaks.',
  bpm: MASS_DRIVER_9281_BPM,
  markers: MASS_DRIVER_9281_MARKERS,
  sections: MASS_DRIVER_9281_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_9281_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x000108,
    bloom: { strength: 1.05, threshold: 0.58, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.05, strength: 0.74 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    let interlocksRemaining = 4;
    const interlockIds = new Set<number>();
    const callouts = [
      { at: MASS_DRIVER_9281_MARKERS.phaseLock, text: 'PHASE LOCK', hold: 1.5 },
      { at: MASS_DRIVER_9281_MARKERS.overdrive, text: 'OVERDRIVE', hold: 1.6 },
      { at: MASS_DRIVER_9281_MARKERS.critical - 1.1, text: 'SAFETY ARRAY JAMMED', hold: 2.2 },
      { at: MASS_DRIVER_9281_MARKERS.muzzle, text: 'CHARGE PEAK', hold: 1.8 },
    ];
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + seconds;
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlocksRemaining = 4;
      interlockIds.clear();
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind !== 'interlock') return;
      interlockIds.add(enemyId);
      if (interlockIds.size === 1) say('CLEAR INTERLOCKS — 4', 2.4);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      interlocksRemaining -= 1;
      if (interlocksRemaining > 0) say(`INTERLOCKS ${interlocksRemaining}`, 1.2);
      else say('SAFETY CLEAR — COMMIT', 3.0);
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
      level: createMassDriver9281Gameplay(bus),
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
        game.update(dt);
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout];
            if (callout.at === MASS_DRIVER_9281_MARKERS.muzzle && interlocksRemaining > 0) {
              setChargeFailure();
            }
            if (callout.at !== MASS_DRIVER_9281_MARKERS.muzzle || interlocksRemaining > 0) {
              say(callout.text, callout.hold);
            }
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        updateVisuals(dt, { scene, camera, feel: cameraFeel, elapsed, runTime, running: game.state === 'running' });
        cameraFeel.update(dt, {
          shake: { pitchDegrees: 0.34, yawDegrees: 0.28, rollDegrees: 0.9, frequency: 11 },
        });
      },
      dispose() {
        game.dispose();
        disposeVisuals(scene, camera);
        cameraFeel.dispose();
      },
    };
  },
};
