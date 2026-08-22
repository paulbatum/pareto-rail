import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { createSpeedsolveGameplay } from './gameplay';
import { FACE_COUNT, FACE_SECONDS, SPEEDSOLVE_BPM, SPEEDSOLVE_MARKERS, SPEEDSOLVE_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateSpeedsolveCameraEffects,
  updateVisuals,
  wireRig,
} from './visuals';
import { speedsolvePost } from './visuals/post-fx';

const FACE_NAMES = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'VIOLET'];

export const speedsolveNfofLevel: LevelDefinition = {
  id: 'speedsolve-nfof',
  title: 'Speedsolve',
  description: 'One continuous boss fight against a colossal twisting puzzle cube: shoot the glowing cells to snap layer rotations on the beat, drop each solved face to expose the machinery beneath, then burst the naked core.',
  bpm: SPEEDSOLVE_BPM,
  markers: SPEEDSOLVE_MARKERS,
  sections: [
    { name: 'scramble', time: SPEEDSOLVE_TIME.bar(0) },
    { name: 'the solve', time: SPEEDSOLVE_TIME.bar(2) },
    { name: 'climax faces', time: SPEEDSOLVE_TIME.bar(16) },
    { name: 'the core', time: SPEEDSOLVE_MARKERS.coreReveal },
  ],
  post: speedsolvePost,
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    const gameplayWithRig = createSpeedsolveGameplay(bus);
    wireRig(gameplayWithRig.rig);

    let runTime = 0;
    let calloutUntil = -1;
    let nextCallout = 0;

    // Face callouts ride the authored phase grid; the solve-state signals drive
    // the dramatic beats (panel falls, swings, core) elsewhere.
    const timedCallouts = [
      ...Array.from({ length: FACE_COUNT }, (_, face) => ({
        at: SPEEDSOLVE_TIME.bar(2) + face * FACE_SECONDS,
        message: `FACE ${face + 1} — ${FACE_NAMES[face]}`,
        seconds: 2.2,
      })),
      { at: SPEEDSOLVE_MARKERS.coreReveal, message: 'CORE EXPOSED', seconds: 3 },
    ];

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
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
        ...gameplayWithRig,
        updateCameraEffects({ camera: effectsCamera, runTime: effectsRunTime, dt }) {
          updateSpeedsolveCameraEffects(dt, { camera: effectsCamera, runTime: effectsRunTime, running: true, feel: cameraFeel });
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
        const running = game.state === 'running';
        if (running) {
          runTime += dt;

          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            hud.setCallout(callout.message);
            calloutUntil = runTime + callout.seconds;
            nextCallout += 1;
          }
          if (calloutUntil >= 0 && runTime >= calloutUntil) {
            hud.setCallout('');
            calloutUntil = -1;
          }
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running, feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
