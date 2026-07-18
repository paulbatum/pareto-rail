import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createBroadsideGameplay } from './gameplay';
import { battle } from './state';
import {
  BROADSIDE_BPM,
  BROADSIDE_MARKERS,
  BROADSIDE_RUN_SECTIONS,
  BROADSIDE_TIME,
  EYE_TIME,
  FLANK_TIME,
  RAKING_TIME,
  TRENCH_TIME,
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
  updateAttractCamera,
  updateCameraEffects as updateBroadsideCameraEffects,
  updateVisuals,
} from './visuals';
import { composeBroadsideOutput } from './visuals/post-fx';

export const broadsideOb4dLevel: LevelDefinition = {
  id: 'broadside-ob4d',
  title: 'Broadside',
  description: 'Launch off your own flagship into a fleet action and fly the gaps to the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x05030a,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius slot
    // and `radius` into the luminance threshold slot; these values are chosen
    // for that mapping. The nebula backdrop peaks near 0.6 luminance, so the
    // effective threshold of 0.66 keeps bloom on the hot rim strips, engines,
    // and ordnance rather than lighting the whole sky.
    bloom: { strength: 0.9, threshold: 0.4, radius: 0.66 },
    vignette: { inner: 0.32, outer: 1.08, strength: 0.7 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration. Gameplay owns the fight; this only watches the clock and the
    // bus, and says as little as it can get away with.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const timedCallouts = [
      { at: FLANK_TIME - 1.6, text: 'ON THE CRUISER — BROADSIDE OVERHEAD', hold: 2.6 },
      { at: RAKING_TIME + 0.1, text: 'UNDER HER KEEL — RAKE THE TURRETS', hold: 2.4 },
      { at: EYE_TIME - 0.5, text: 'ENEMY FLAGSHIP', hold: 2.6 },
      { at: TRENCH_TIME - 0.4, text: 'INTO THE TRENCH', hold: 2.0 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELD DOWN — COUPLINGS EXPOSED', 2.8);
      if (phase === 'destroyed') say('FLAGSHIP BREAKING UP', 3.4);
    });

    bus.on('volley', ({ size, kills }) => {
      if (battle.broadsideVolley && kills === size) {
        say(size >= 6 ? 'FULL BROADSIDE' : `BROADSIDE — ${size} GUNS`, 1.5);
      }
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
        ...createBroadsideGameplay(bus),
        updateAttractCamera({ camera: attractCamera, modeTime }) {
          updateAttractCamera(attractCamera, modeTime);
        },
        updateCameraEffects({ camera: runCamera, runTime: time, dt }) {
          updateBroadsideCameraEffects(dt, { camera: runCamera, runTime: time, running: true, feel: cameraFeel });
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
