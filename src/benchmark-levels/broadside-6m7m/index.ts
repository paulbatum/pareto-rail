import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createBroadsideGameplay } from './gameplay';
import { BARS, BROADSIDE_BPM, BROADSIDE_MARKERS, BROADSIDE_RUN_SECTIONS, BROADSIDE_TIME, bar } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateBroadsideCameraEffects,
  updateVisuals,
} from './visuals';
import { composeBroadsideOutput } from './visuals/post-fx';

// Capital ships are kilometres long and the nebula is the sky; the default
// 500-unit far plane would clip both. The runtime widens it and puts it back.
const FAR_PLANE = 5200;

export const broadside6m7mLevel: LevelDefinition = {
  id: 'broadside-6m7m',
  title: 'Broadside',
  description: 'Launch off your flagship into a fleet engagement, fly the gaps, and gut the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({ name: section.name, time: BROADSIDE_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x05010a,
    bloom: { strength: 0.85, threshold: 0.7, radius: 0.15 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.7 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const previousFar = camera.far;
    camera.far = FAR_PLANE;
    camera.updateProjectionMatrix();
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the set pieces get names. Gameplay owns the fight; this only
    // watches the clock and the bus.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.05, text: 'CATAPULT — LAUNCH', hold: 1.6 },
      { at: bar(BARS.gaps), text: 'THROUGH THE GAPS', hold: 2.0 },
      { at: BROADSIDE_MARKERS.roll - 0.3, text: 'ROLL', hold: 1.2 },
      { at: bar(BARS.flank) - 0.4, text: 'BROADSIDE OVERHEAD — HEADS DOWN', hold: 2.4 },
      { at: bar(BARS.eye), text: 'THE EYE', hold: 2.2 },
      { at: bar(BARS.belly) - 0.3, text: 'ENEMY WARSHIP — RAKE THE BELLY', hold: 2.4 },
      { at: bar(BARS.flagship) - 0.5, text: 'FLAGSHIP — TAKE THE SHIELD GENERATORS', hold: 3.0 },
      { at: bar(BARS.trench) - 0.2, text: 'TRENCH RUN — THE POWER CORES', hold: 2.6 },
    ];
    let nextCallout = 0;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELD DOWN — ESCORTS INBOUND', 2.6);
      if (phase === 'destroyed') say('ENEMY FLAGSHIP DESTROYED — PULL OUT', 4.0);
    });
    bus.on('shielded', () => say('SHIELD HOLDING — KILL THE GENERATORS', 1.4));
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const gameplay = createBroadsideGameplay(bus);
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
        disposeEnvironment();
        camera.far = previousFar;
        camera.updateProjectionMatrix();
      },
    };
  },
};
