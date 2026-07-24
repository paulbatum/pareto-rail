import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSpeedsolveGameplay } from './gameplay';
import { SPEEDSOLVE_BPM, SPEEDSOLVE_RUN_SECTIONS, SPEEDSOLVE_TIME, bar } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraFeel,
  updateVisuals,
} from './visuals';
import { composeSpeedsolveOutput } from './visuals/post-fx';

export const speedsolveQ7ldLevel: LevelDefinition = {
  id: 'speedsolve-q7ld',
  title: 'Speedsolve',
  description: 'One continuous boss fight against a colossal twisting-puzzle cube: shoot it to solve it, face by face, until the naked core bursts into confetti.',
  bpm: SPEEDSOLVE_BPM,
  markers: {
    firstFace: bar(1),
    firstSwing: bar(3.6),
    midSolve: bar(13),
    coreReveal: bar(24.2),
    finale: bar(28.5),
  },
  sections: SPEEDSOLVE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SPEEDSOLVE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0xe4e2de,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius
    // slot and `radius` into the luminance threshold slot; these values are
    // chosen for that mapping. The pale void sits near 0.87 luminance, so the
    // effective threshold of 1.02 keeps bloom on HDR cores only.
    bloom: { strength: 0.75, threshold: 0.45, radius: 1.02 },
    vignette: { inner: 0.42, outer: 1.2, strength: 0.42 },
    composeOutput: composeSpeedsolveOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration stays terse and mechanical — a solve timer, not a war story.
    let calloutUntil = -1;
    let now = 0;
    let runTime = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    let weakpointSeen = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'weakpoint' && !weakpointSeen) {
        weakpointSeen = true;
        say('WEAKPOINT EXPOSED', 2.0);
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('SIX DOWN — CORE EXPOSED', 2.6);
      if (phase === 'destroyed') say('SOLVED', 3.0);
    });
    bus.on('runstart', () => {
      weakpointSeen = false;
      calloutUntil = -1;
      runTime = 0;
      hud.setCallout('');
    });

    const gameplay = createSpeedsolveGameplay(bus);
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
        updateCameraEffects(context) {
          gameplay.updateCameraEffects?.(context);
          updateCameraFeel(context.dt, { camera: context.camera, runTime: context.runTime, running: true, feel: cameraFeel });
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
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        const running = game.state === 'running';
        if (running) runTime += dt;
        else updateCameraFeel(dt, { camera, runTime: 0, running: false, feel: cameraFeel });
        updateVisuals(dt, { scene, camera, elapsed, runTime, running, feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
