import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSpeedsolveGameplay } from './gameplay';
import { SPEEDSOLVE_BPM, SPEEDSOLVE_MARKERS, SPEEDSOLVE_RUN_SECTIONS, SPEEDSOLVE_TIME } from './timing';
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
  updateCameraEffects as updateSpeedsolveCamera,
  updateVisuals,
} from './visuals';
import { composeSpeedsolveOutput } from './visuals/post-fx';

export const speedsolveZq4nLevel: LevelDefinition = {
  id: 'speedsolve-zq4n',
  title: 'Speedsolve',
  description: 'One continuous boss fight against a colossal twisting puzzle cube. Shoot it to solve it.',
  bpm: SPEEDSOLVE_BPM,
  markers: SPEEDSOLVE_MARKERS,
  sections: SPEEDSOLVE_RUN_SECTIONS.map((section) => ({ name: section.name, time: SPEEDSOLVE_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x2f3238,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius slot
    // and `radius` into the luminance threshold slot. The void tops out near
    // 0.45 luminance, so the effective threshold of 0.92 keeps bloom on the HDR
    // accents — hot cores, lock brackets, the reticle — and off the room. A
    // pale room has almost no headroom; the strength is low for the same reason.
    bloom: { strength: 0.42, threshold: 0.3, radius: 0.92 },
    vignette: { inner: 0.34, outer: 1.1, strength: 0.58 },
    composeOutput: composeSpeedsolveOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the solve calls its own splits, the way a speedcuber would.
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    let faceIndex = 0;
    let coreOpen = false;
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') {
        faceIndex += 1;
        say(faceIndex >= 6 ? 'LAST FACE — CORE COMING UP' : `FACE ${faceIndex}/6 — WEAKPOINT OPEN`, 1.5);
      }
      if (phase === 'summoned') {
        coreOpen = true;
        say('CORE EXPOSED', 2.2);
      }
      if (phase === 'destroyed') say('SOLVED', 3.2);
    });
    bus.on('runstart', () => {
      faceIndex = 0;
      coreOpen = false;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('runend', () => {
      if (coreOpen) return;
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
        // Gameplay owns the face clock, the cube's animation, and the look-at;
        // the visuals layer adds bank, FOV, and shake on top of the result.
        updateCameraEffects(context) {
          gameplay.updateCameraEffects?.(context);
          updateSpeedsolveCamera(context.dt, { ...context, feel: cameraFeel });
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

    let runTime = 0;
    bus.on('runstart', () => {
      runTime = 0;
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        const running = game.state === 'running';
        if (running) runTime += dt;
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
      },
    };
  },
};
