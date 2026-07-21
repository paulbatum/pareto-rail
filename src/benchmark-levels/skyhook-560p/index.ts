import { Vector3 } from 'three';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhookGameplay, SKYHOOK_BPM } from './gameplay';
import { SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME, bar } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateSkyhookCameraEffects,
  updateVisuals,
} from './visuals';
import { composeSkyhookOutput } from './visuals/post-fx';

// The camera flies straight up the tether, so the world's up axis cannot also
// be the camera's up axis. World +Y is altitude; the camera's up is world +Z.
// Everything downstream — the runner's lookAt, the attract drift, the letter
// placement — is then perfectly conditioned, and screen right/up map onto world
// +X/+Z, which is exactly what `climbOffset` in gameplay.ts authors against.
const CLIMB_CAMERA_UP = new Vector3(0, 0, 1);

export const skyhook560pLevel: LevelDefinition = {
  id: 'skyhook-560p',
  title: 'Skyhook',
  description: 'Ride a climber car up a space elevator and keep it alive all the way to the station.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SKYHOOK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x161a20,
    bloom: { strength: 0.72, threshold: 0.68, radius: 0.24 },
    vignette: { inner: 0.42, outer: 1.15, strength: 0.6 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const previousUp = camera.up.clone();
    camera.up.copy(CLIMB_CAMERA_UP);

    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the climb is told in altitudes. Gameplay owns the fight; this
    // only watches the clock and the bus and says how high the car has got.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const timedCallouts = [
      { at: 0.4, text: 'CLIMBER 12 — ASCENT', hold: 2.2 },
      { at: bar(6.4), text: 'CLOUD DECK', hold: 1.6 },
      { at: bar(8.1), text: 'DECK CLEARED — 9 KM', hold: 2.2 },
      { at: bar(16), text: 'AIR THINNING — 46 KM', hold: 2.2 },
      { at: bar(20), text: 'KÁRMÁN LINE — 100 KM', hold: 2.2 },
      { at: bar(23.2), text: 'MASS ON THE TETHER — ABOVE YOU', hold: 2.6 },
      { at: bar(36.1), text: 'STATION APERTURE — HOLD ON', hold: 2.6 },
      { at: bar(39.1), text: 'DOCKED', hold: 3.0 },
    ];
    let nextCallout = 0;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('CORE EXPOSED', 2.2);
      if (phase === 'destroyed') say('TETHER CLEAR — RUN FOR THE STATION', 3.0);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
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
        ...createSkyhookGameplay(bus),
        updateCameraEffects({ camera: runnerCamera, runTime: at, dt }) {
          updateSkyhookCameraEffects(dt, { camera: runnerCamera, runTime: at, running: true, feel: cameraFeel });
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
            say(callout.text, callout.hold);
            nextCallout += 1;
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
        camera.up.copy(previousUp);
      },
    };
  },
};
