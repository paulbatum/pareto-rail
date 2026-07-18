import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createBroadsideGameplay } from './gameplay';
import {
  BROADSIDE_BPM,
  BROADSIDE_MARKERS,
  BROADSIDE_RUN_SECTIONS,
  BROADSIDE_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  notifyVictory,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateBroadsideCameraEffects,
  updateVisuals,
} from './visuals';
import { composeBroadsideOutput } from './visuals/post-fx';

export const broadsideB9mnLevel: LevelDefinition = {
  id: 'broadside-b9mn',
  title: 'Broadside',
  description: 'Launch off your flagship into a full fleet engagement and carry the fight to the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x030208,
    bloom: { strength: 0.75, threshold: 0.3, radius: 0.6 },
    vignette: { inner: 0.32, outer: 1.1, strength: 0.68 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the sortie's waypoints get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.3, text: 'CATAPULT — GOOD HUNTING', hold: 2.2 },
      { at: BROADSIDE_MARKERS.broadside + 0.1, text: 'BROADSIDE FIRING OVERHEAD', hold: 2.4 },
      { at: BROADSIDE_MARKERS.eye + 0.2, text: 'THE EYE — HOLD FIRE', hold: 2.0 },
      { at: BROADSIDE_MARKERS.belly + 0.3, text: 'TURRET LINE — RAKE THE KEEL', hold: 2.4 },
      { at: BROADSIDE_MARKERS.flagship + 0.2, text: 'SHIELD GENERATORS — TAKE THEM OUT', hold: 2.8 },
      { at: BROADSIDE_MARKERS.trench + 0.2, text: 'INTO THE TRENCH', hold: 2.2 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;
    let victoryHandled = false;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELD DOWN', 2.4);
      if (phase === 'destroyed' && !victoryHandled) {
        victoryHandled = true;
        notifyVictory(runTime);
        say('FLAGSHIP DESTROYED — THE LINE BREAKS', 3.6);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      victoryHandled = false;
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
        updateCameraEffects({ camera, runTime, dt }) {
          updateBroadsideCameraEffects(dt, { camera, runTime, running: true, feel: cameraFeel });
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
