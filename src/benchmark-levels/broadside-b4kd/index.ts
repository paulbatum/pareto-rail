import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BROADSIDE_BPM, createBroadsideGameplay } from './gameplay';
import { BROADSIDE_MARKERS, BROADSIDE_RUN_SECTIONS, BROADSIDE_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateBroadsideCameraEffects,
  updateVisuals,
} from './visuals';
import { composeBroadsideOutput } from './visuals/post-fx';

export const broadsideB4kdLevel: LevelDefinition = {
  id: 'broadside-b4kd',
  title: 'Broadside',
  description: 'Launch into a fleet engagement, fly the gaps, and break the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x040108,
    bloom: { strength: 0.95, threshold: 0.55, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.72 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the crossing's set pieces get names. Gameplay owns the
    // fight; this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.2, text: 'CATAPULT — GOOD HUNTING', hold: 2.2 },
      { at: BROADSIDE_MARKERS.broadside - 1.0, text: 'BROADSIDE OVERHEAD', hold: 2.4 },
      { at: BROADSIDE_MARKERS.eye + 0.2, text: 'THE EYE OF THE BATTLE', hold: 2.4 },
      { at: BROADSIDE_MARKERS.belly + 0.6, text: 'UNDER HER KEEL — RAKE THE TURRETS', hold: 2.6 },
      { at: BROADSIDE_MARKERS.flagship, text: 'THE FLAGSHIP — BURN HER SHIELD GENERATORS', hold: 3.0 },
      { at: BROADSIDE_MARKERS.trench + 0.2, text: 'INTO THE TRENCH', hold: 2.2 },
      { at: BROADSIDE_MARKERS.end + 999, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELD DOWN — HER CORES ARE BARE', 3.0);
      if (phase === 'destroyed') say('FLAGSHIP DESTROYED — THE LINE BREAKS', 4.0);
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
