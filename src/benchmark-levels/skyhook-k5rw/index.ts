import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhookGameplay } from './gameplay';
import {
  DECK_TIME,
  DOCK_TIME,
  SIGHTING_TIME,
  SKYHOOK_BPM,
  SKYHOOK_MARKERS,
  SKYHOOK_RUN_SECTIONS,
  SKYHOOK_TIME,
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
  updateCameraEffects as updateSkyhookCameraEffects,
  updateVisuals,
} from './visuals';
import { composeSkyhookOutput } from './visuals/post-fx';

export const skyhookLevel: LevelDefinition = {
  id: 'skyhook-k5rw',
  title: 'Skyhook',
  description: 'Ride a climber car up the tether and keep it alive all the way to the station.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SKYHOOK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x0c0e11,
    // A sunlit sky is legitimately bright, so the cut-off has to sit above it:
    // only the level's HDR hardware (hazard paint, signal lights, locks, hits)
    // is allowed to glow. Note that the shared pass in src/engine/post.ts hands
    // these two fields to BloomNode as (radius, threshold) in that order, so on
    // this level `radius` is the luminance cut-off and `threshold` is the blur
    // width. Values chosen by what the frame actually does, not by the names.
    bloom: { strength: 1.1, threshold: 0.3, radius: 0.8 },
    vignette: { inner: 0.4, outer: 1.12, strength: 0.62 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration. The climb has a handful of things worth saying out loud;
    // gameplay owns the fight, this only watches the clock and the bus.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.4, text: 'ANCHOR CLAMPS CLEAR', hold: 2.2 },
      { at: DECK_TIME - 1.6, text: 'CLOUD DECK', hold: 2.2 },
      { at: SIGHTING_TIME, text: 'CONTACT — HIGH ON THE TETHER', hold: 3.0 },
      { at: DOCK_TIME + 1.2, text: 'STATION — DOCKING', hold: 3.2 },
    ];
    let nextCallout = 0;

    let coreId = -1;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'core') coreId = enemyId;
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('CORE EXPOSED', 2.4);
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === coreId) say('IT LOST THE CABLE — CLIMB', 3.4);
    });
    bus.on('miss', ({ enemyId }) => {
      if (enemyId === coreId) say('IT HAS THE CAR', 3.0);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      coreId = -1;
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
        updateAttractCamera({ modeTime }) {
          updateAttractCamera(camera, modeTime);
        },
        updateCameraEffects({ runTime: time, dt }) {
          updateSkyhookCameraEffects(dt, { camera, runTime: time, running: true, feel: cameraFeel });
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
      },
    };
  },
};
