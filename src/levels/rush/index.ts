import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { RUSH_BPM, RUSH_RUN_DURATION, rushGameplay, speedFactorAt } from './gameplay';
import { RUSH_TUNING } from './tuning';
import { composeRushOutput, decayRushPost, kickRushSurgeFlash } from './post-fx';
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
  updateVisuals,
} from './visuals';

const SURGE_TIMES = RUSH_TUNING.speedProfile.keys
  .slice(1)
  .filter((key, index) => key[1] - RUSH_TUNING.speedProfile.keys[index][1] > RUSH_TUNING.speedProfile.surgeMinimumDelta)
  .map((key) => key[0]);

export const rushLevel: LevelDefinition = {
  id: 'rush',
  title: 'Rush',
  description: 'A dark boost tunnel built to stress-test extreme forward speed cues.',
  bpm: RUSH_BPM,
  sections: [
    { name: 'launch', time: 0 },
    { name: 'surge one', time: SURGE_TIMES[0] ?? 0 },
    { name: 'surge two', time: SURGE_TIMES[1] ?? 0 },
    { name: 'terminal rush', time: SURGE_TIMES[2] ?? 0 },
  ],
  post: {
    clearColor: 0x000000,
    bloom: { strength: 0.78, threshold: 0.62, radius: 0.16 },
    vignette: { inner: 0.24, outer: 1.08, strength: 0.72 },
    composeOutput: composeRushOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    const feel = createCameraFeel(camera);

    let runClock = 0;
    let running = false;
    bus.on('runstart', () => {
      runClock = 0;
      running = true;
    });
    bus.on('runend', () => {
      running = false;
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
      level: rushGameplay,
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
        game.update(dt);
        if (running && game.state === 'running') {
          const previous = runClock;
          runClock = Math.min(RUSH_RUN_DURATION, runClock + dt);
          for (const surgeTime of SURGE_TIMES) {
            if (previous < surgeTime && runClock >= surgeTime) {
              feel.kickFov(RUSH_TUNING.fov.surgeKickDegrees);
              kickRushSurgeFlash(RUSH_TUNING.post.surgeFlash);
            }
          }
        }
        const isRunning = running && game.state === 'running';
        const speedFactor = isRunning ? speedFactorAt(runClock) : 1;
        decayRushPost(dt);
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          running: isRunning,
          speedFactor,
          feel,
          runProgress: game.runProgress,
        });
        feel.update(dt, {
          shake: {
            maxTrauma: RUSH_TUNING.shake.maxTrauma,
            decay: RUSH_TUNING.shake.decay,
            pitchDegrees: RUSH_TUNING.shake.pitchDegrees,
            yawDegrees: RUSH_TUNING.shake.yawDegrees,
            rollDegrees: RUSH_TUNING.shake.rollDegrees,
            frequency: RUSH_TUNING.shake.frequency,
            smoothing: RUSH_TUNING.shake.smoothing,
          },
        });
      },
      dispose() {
        game.dispose();
        feel.dispose();
        disposeEnvironment();
      },
    };
  },
};
