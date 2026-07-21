import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay, MASS_DRIVER_BPM } from './gameplay';
import {
  INTERLOCK_SPAWN_TIME,
  JAM_TIME,
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
  disposeVisuals,
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
  description: 'Ride the payload down an orbital railgun. One ring every beat, and the gun is already charging.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x01020a,
    // A high threshold: only ring filaments, cores, and arcs bloom. The bore
    // plate stays dark so the tunnel reads as metal rather than fog.
    bloom: { strength: 1.15, threshold: 0.62, radius: 0.24 },
    vignette: { inner: 0.34, outer: 1.12, strength: 0.8 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the barrel talks to you the way a launch facility would.
    // Gameplay owns the fight; this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.4, text: 'PAYLOAD AWAY', hold: 2.0 },
      { at: OVERDRIVE_TIME - 0.15, text: 'STAGE TWO — ACCELERATING', hold: 2.2 },
      { at: JAM_TIME - 0.15, text: 'SAFETY INTERLOCKS JAMMED', hold: 2.6 },
      { at: INTERLOCK_SPAWN_TIME, text: 'CLEAR THE INTERLOCKS', hold: 2.4 },
      { at: MUZZLE_TIME - 4.4, text: 'CHARGE CRITICAL', hold: 2.4 },
    ];
    let nextCallout = 0;
    let cleared = false;
    let announcedMuzzle = false;

    bus.on('bossphase', ({ phase }) => {
      if (phase !== 'destroyed' || cleared) return;
      cleared = true;
      say('BARREL CLEAR — BRACE', 3.0);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      cleared = false;
      announcedMuzzle = false;
      calloutUntil = -1;
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
        ...createMassDriverGameplay(bus),
        updateCameraEffects({ camera: runCamera, runTime: elapsedRunTime, dt }) {
          updateMassDriverCameraEffects(dt, { camera: runCamera, runTime: elapsedRunTime, running: true, feel: cameraFeel });
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
            const callout = timedCallouts[nextCallout];
            // Once the barrel is clear the charge warning is no longer true.
            if (!(cleared && callout.text === 'CHARGE CRITICAL')) say(callout.text, callout.hold);
            nextCallout += 1;
          }
          if (!announcedMuzzle && cleared && runTime >= MUZZLE_TIME) {
            announcedMuzzle = true;
            say('MUZZLE', 2.6);
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
        disposeVisuals(camera);
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
