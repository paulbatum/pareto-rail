import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createBroadsideGameplay } from './gameplay';
import {
  BELLY_TIME,
  BROADSIDE_BPM,
  BROADSIDE_MARKERS,
  BROADSIDE_RUN_SECTIONS,
  BROADSIDE_RUN_TIME,
  BROADSIDE_TIME,
  EYE_TIME,
  FLAGSHIP_TIME,
  MELEE1_TIME,
  MELEE2_TIME,
  SCREEN_TIME,
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
  updateCameraEffects as updateBroadsideCameraEffects,
  updateVisuals,
} from './visuals';
import { composeBroadsideOutput } from './visuals/post-fx';

export const broadsideB2o2Level: LevelDefinition = {
  id: 'broadside-b2o2',
  title: 'Broadside',
  description:
    "Launch off the home carrier into a fleet engagement: ride a friendly cruiser's broadside, rake an enemy belly, and dive the flagship's trench to kill her core.",
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x0a0512,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius
    // slot and `radius` into the luminance threshold slot; these values are
    // chosen for that mapping. The nebula's magenta band peaks near 0.71, so
    // the effective threshold of 0.75 keeps the sky from blooming into milk —
    // only the gold heart and hot HDR elements (engines, tracers, muzzle
    // blooms, the dying flagship) catch.
    bloom: { strength: 0.85, threshold: 0.32, radius: 0.75 },
    vignette: { inner: 0.3, outer: 1.1, strength: 0.68 },
    composeOutput: composeBroadsideOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the run's waypoints get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.15, text: 'SCRAMBLE — THE FLEET IS ENGAGED', hold: 2.6 },
      { at: MELEE1_TIME, text: 'CROSSFIRE — SKIRMISH LINE AHEAD', hold: 2.2 },
      { at: BROADSIDE_RUN_TIME + 0.1, text: 'RELENTLESS BROADSIDE — RIDE HER FLANK', hold: 2.6 },
      { at: EYE_TIME + 0.1, text: 'EYE OF THE STORM', hold: 2.4 },
      { at: MELEE2_TIME + 0.1, text: 'BACK INTO IT — WATCH THE WRECK FIELD', hold: 2.4 },
      { at: BELLY_TIME + 0.2, text: 'RAKE HER BELLY — TURRETS LIVE', hold: 2.6 },
      { at: FLAGSHIP_TIME + 0.1, text: 'FLAGSHIP SOVEREIGN — KILL HER SHIELDS', hold: 2.8 },
      { at: SCREEN_TIME + 0.1, text: 'AROUND HER STERN', hold: 2.0 },
      { at: TRENCH_TIME + 0.1, text: 'INTO THE TRENCH', hold: 2.2 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let gunshipSeen = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'gunship' && !gunshipSeen) {
        gunshipSeen = true;
        say('GUNSHIP — CRACK HER ARMOR', 2.4);
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELDS DOWN — SHE IS NAKED', 2.6);
      if (phase === 'destroyed') say("DIRECT HIT — SHE'S COMING APART", 4.2);
    });
    bus.on('volley', ({ size, kills }) => {
      if (size >= 6 && kills === size) say('FULL BROADSIDE', 1.6);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      gunshipSeen = false;
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
