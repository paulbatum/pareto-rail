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
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateBroadsideCameraEffects,
  updateVisuals,
} from './visuals';
import { composeBroadsideOutput } from './visuals/post-fx';

export const broadsideOb3cLevel: LevelDefinition = {
  id: 'broadside-ob3c',
  title: 'Broadside',
  description: 'Launch off your own flagship into the middle of a fleet engagement and fly the gaps to the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x030208,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius slot
    // and `radius` into the luminance threshold slot; these values are chosen
    // for that mapping. The nebula peaks near 0.5 luminance, so an effective
    // threshold of 0.8 sits above the nebula's brightest filaments, so bloom
    // stays on gunfire, heat cores and hull rims rather than smearing the sky.
    bloom: { strength: 0.95, threshold: 0.34, radius: 0.8 },
    vignette: { inner: 0.3, outer: 1.12, strength: 0.78 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Callouts name the set pieces the way a flight lead would. Gameplay owns
    // the fight; this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const timedCallouts = [
      { at: BROADSIDE_TIME.bar(7.4), text: 'FRIENDLY BROADSIDE — FLY HER FLANK', hold: 2.4 },
      { at: BROADSIDE_TIME.bar(12.1), text: 'UNDER HER BELLY — RAKE THE TURRETS', hold: 2.4 },
      { at: BROADSIDE_TIME.bar(15.8), text: 'ENEMY FLAGSHIP — CUT THE SHIELD GENERATORS', hold: 2.8 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELD DOWN — INTO THE TRENCH', 2.8);
      if (phase === 'destroyed') say('FLAGSHIP BREAKING — THE LINE IS OURS', 3.4);
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
