import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import type { LevelDefinition } from '../../engine/types';
import { createAudio } from './audio';
import { createSpeedsolveGameplay, SPEEDSOLVE_BPM } from './gameplay';
import { SPEEDSOLVE_MARKERS, SPEEDSOLVE_RUN_SECTIONS, SPEEDSOLVE_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

const FACE_NAMES = ['RED FACE', 'GREEN FACE', 'ORANGE FACE', 'BLUE FACE', 'YELLOW FACE', 'VIOLET FACE'];

export const speedsolveP4tnLevel: LevelDefinition = {
  id: 'speedsolve-p4tn',
  title: 'Speedsolve',
  description: 'Sixty seconds to solve a colossal twisting cube, one beat-locked layer at a time.',
  bpm: SPEEDSOLVE_BPM,
  markers: SPEEDSOLVE_MARKERS,
  sections: SPEEDSOLVE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SPEEDSOLVE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0xa8b0bd,
    // A pale hall only works if bloom stays off the hall itself, so this level
    // wants a high cut-off and a tight radius. Note the engine forwards these two
    // fields to three's `bloom(node, strength, radius, threshold)` in the order
    // (threshold, radius) — so `threshold` here is the blur radius and `radius`
    // here is the luminance cut-off. Read as three sees it: strength 0.83,
    // radius 0.3, cut-off 1.15 — only genuinely HDR cores and hot lines glow.
    bloom: { strength: 1.1, threshold: 0.3, radius: 1.15 },
    vignette: { inner: 0.42, outer: 1.14, strength: 0.34 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    const gameplay = createSpeedsolveGameplay(bus);
    createEnvironment(scene, gameplay.cube);
    installVisualEventHandlers(bus, scene);

    // Callouts narrate the solve; gameplay owns every decision behind them.
    let calloutUntil = -1;
    let now = 0;
    let facesSolved = 0;
    let presentedFace = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') {
        facesSolved += 1;
        say(`FACE ${facesSolved}/6 — WEAKPOINT`, 1.9);
      }
      if (phase === 'summoned') say('SHELL OPEN — CORE', 2.2);
      if (phase === 'destroyed') say('SOLVED', 3.2);
    });
    // The mid-snap refusal is the one rule the player has to learn; name it the
    // first time the mechanism turns them down.
    bus.on('shielded', () => say('LAYER TURNING — WAIT FOR THE BEAT', 1.3));
    bus.on('runstart', () => {
      calloutUntil = -1;
      facesSolved = 0;
      presentedFace = -1;
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
      level: gameplay,
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
        if (running && gameplay.cube.faceIndex !== presentedFace) {
          presentedFace = gameplay.cube.faceIndex;
          if (calloutUntil < 0) say(FACE_NAMES[presentedFace] ?? 'FACE', 1.4);
        }
        updateVisuals({ camera, feel, dt, elapsed, runProgress: game.runProgress, running });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
        disposeVisuals(scene);
      },
    };
  },
};
