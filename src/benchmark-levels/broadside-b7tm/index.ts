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
  bar,
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

export const broadsideB7tmLevel: LevelDefinition = {
  id: 'broadside-b7tm',
  title: 'Broadside',
  description: 'Launch off your own flagship into a full fleet engagement and fly the gaps to the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x05020a,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius slot
    // and `radius` into the luminance threshold slot. The nebula backdrop peaks
    // around 0.6 luminance, so the effective threshold keeps bloom on tracers,
    // engine bells and hot cores rather than on the sky.
    bloom: { strength: 0.95, threshold: 0.4, radius: 0.66 },
    vignette: { inner: 0.3, outer: 1.12, strength: 0.8 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: a wing leader calling the run. Gameplay owns the fight; this
    // only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    let shieldDown = false;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const timedCallouts = [
      { at: bar(3.6), text: 'INTO THE GAP', hold: 2.0 },
      { at: bar(11.7), text: 'FRIENDLY BROADSIDE OVERHEAD', hold: 2.4 },
      { at: bar(17.8), text: 'UNDER THE WARSHIP — RAKE THE TURRETS', hold: 2.6 },
      { at: bar(22.8), text: 'ENEMY FLAGSHIP — KILL THE GENERATORS', hold: 2.8 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;
    let shieldVerdictAt = -1;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') {
        shieldDown = true;
        say('SHIELD DOWN — INTO THE TRENCH', 2.8);
      } else if (phase === 'destroyed') {
        say('FLAGSHIP BREAKING — GET CLEAR', 3.4);
      }
    });

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      shieldDown = false;
      shieldVerdictAt = bar(28.6);
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
        const running = game.state === 'running';
        if (running) {
          runTime += dt;
          while (nextCallout < timedCallouts.length - 1 && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
          }
          // The one line that depends on how the shield pass actually went.
          if (shieldVerdictAt >= 0 && runTime >= shieldVerdictAt) {
            shieldVerdictAt = -1;
            if (!shieldDown) say('SHIELD HOLDING — THE CORES ARE COVERED', 3.0);
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
