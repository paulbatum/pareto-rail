import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhookGameplay } from './gameplay';
import { CLOUDBREAK_TIME, DOCK_TIME, SKYHOOK_BPM, SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME, STRATOSPHERE_TIME } from './timing';
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

export const skyhookSnxdLevel: LevelDefinition = {
  id: 'skyhook-snxd',
  title: 'Skyhook',
  description: 'Ride a climber car up the space elevator and defend it from the storm to the station.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SKYHOOK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x14171b,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius
    // slot and `radius` into the luminance threshold slot; these values are
    // chosen for that mapping. The day sky peaks near 0.55 luminance, so the
    // effective threshold of 0.62 keeps bloom on hot HDR elements only.
    bloom: { strength: 0.85, threshold: 0.35, radius: 0.62 },
    vignette: { inner: 0.34, outer: 1.1, strength: 0.72 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the climb's waypoints get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: CLOUDBREAK_TIME - 2.1, text: 'CLOUD DECK', hold: 1.9 },
      { at: STRATOSPHERE_TIME + 0.1, text: 'AIR THINNING', hold: 2.0 },
      { at: DOCK_TIME + SKYHOOK_TIME.bar(2.1), text: 'DOCKED', hold: 2.4 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let sapperSeen = false;
    let mawKilled = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'sapper' && !sapperSeen) {
        sapperSeen = true;
        say('SAPPER — GET IT OFF THE CAR', 2.6);
      }
      if (kind === 'maw') say('LAMPREY ON THE TETHER', 3.0);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('GRIP BROKEN — CORE OPEN', 2.4);
      if (phase === 'summoned' && !mawKilled) say("IT'S ON THE CAR", 2.6);
      if (phase === 'destroyed') {
        mawKilled = true;
        say('TETHER CLEAR — BRING IT HOME', 3.4);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      sapperSeen = false;
      mawKilled = false;
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
        updateCameraEffects({ camera, runTime, dt }) {
          updateSkyhookCameraEffects(dt, { camera, runTime, running: true, feel: cameraFeel });
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
