import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay } from './gameplay';
import {
  FAULT_TIME,
  INTERLOCK_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_RUN_SECTIONS,
  MASS_DRIVER_TIME,
  MUZZLE_TIME,
  OVERDRIVE_TIME,
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
  updateCameraEffects as updateMassDriverCameraEffects,
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverRqkiLevel: LevelDefinition = {
  id: 'mass-driver-rqki',
  title: 'Mass Driver',
  description: 'Ride a payload down an orbital railgun. One coil per beat, all the way to the muzzle.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x01020a,
    // Thin filaments and small cores carry the glow here, so the bore can take a
    // strong bloom without the tunnel washing out into a white sheet.
    bloom: { strength: 0.85, threshold: 0.68, radius: 0.22 },
    vignette: { inner: 0.3, outer: 1.05, strength: 0.72 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration. The barrel only ever says operational things to the payload;
    // the drama is entirely in what those things mean for the next ten seconds.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const timedCallouts = [
      { at: OVERDRIVE_TIME, text: 'OVERDRIVE', hold: 1.8 },
      { at: FAULT_TIME, text: 'SAFETY FAULT — CHARGE BUILDING', hold: 2.8 },
      { at: INTERLOCK_TIME - 0.25, text: 'BLOW THE INTERLOCKS', hold: 2.6 },
    ];
    let nextCallout = 0;

    const interlockIds = new Set<number>();
    let interlocksSeen = 0;
    let announcedClear = false;
    let announcedOutcome = false;

    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind !== 'interlock') return;
      interlockIds.add(enemyId);
      interlocksSeen += 1;
    });
    bus.on('kill', ({ enemyId }) => {
      interlockIds.delete(enemyId);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlockIds.clear();
      interlocksSeen = 0;
      announcedClear = false;
      announcedOutcome = false;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const massDriverGameplay = createMassDriverGameplay(bus);
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
        ...massDriverGameplay,
        updateCameraEffects({ camera: runCamera, runTime: currentRunTime, dt }) {
          updateMassDriverCameraEffects(dt, {
            camera: runCamera,
            runTime: currentRunTime,
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
          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
            say(timedCallouts[nextCallout].text, timedCallouts[nextCallout].hold);
            nextCallout += 1;
          }
          if (!announcedClear && interlocksSeen > 0 && interlockIds.size === 0 && runTime < MUZZLE_TIME) {
            announcedClear = true;
            say('SAFETIES CLEAR', 2.2);
          }
          if (!announcedOutcome && interlocksSeen > 0 && runTime >= MUZZLE_TIME) {
            announcedOutcome = true;
            say(interlockIds.size === 0 ? 'FIRE' : 'BARREL BREACH', 3.2);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running', feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
