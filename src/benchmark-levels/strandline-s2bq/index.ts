import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import { CROWN_TIME, REVEAL_TIME, SERENE_TIME, STRANDLINE_BPM, STRANDLINE_MARKERS, STRANDLINE_RUN_SECTIONS, STRANDLINE_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineS2bqLevel: LevelDefinition = {
  id: 'strandline-s2bq',
  title: 'Strandline',
  description: 'Free a gigantic jellyfish from its parasites, threading the glowing strands of its own tentacles.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x04101e,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius
    // slot and `radius` into the luminance threshold slot; values are chosen
    // for that mapping. Open water sits well under 0.5 luminance, so the
    // effective threshold of 0.58 keeps bloom on strand pulses, cores, and
    // player light only.
    bloom: { strength: 0.8, threshold: 0.4, radius: 0.58 },
    vignette: { inner: 0.32, outer: 1.12, strength: 0.68 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the passage's waypoints get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: REVEAL_TIME + 0.1, text: 'THE BELL', hold: 2.2 },
      { at: CROWN_TIME - 2.2, text: 'THE CROWN — WHERE THE STRANDS ROOT', hold: 2.0 },
      { at: SERENE_TIME + STRANDLINE_TIME.bar(1), text: 'IT DRIFTS ON, FREE', hold: 2.6 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let matriarchDead = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'matriarch') say('THE MATRIARCH — KILL HER BROODS', 3.0);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHE IS BARE — TEAR HER LOOSE', 2.6);
      if (phase === 'destroyed') {
        matriarchDead = true;
        say('EVERY STRAND RUNS CLEAN', 3.0);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      matriarchDead = false;
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
        ...createStrandlineGameplay(bus),
        updateCameraEffects({ camera, runTime, dt }) {
          updateStrandlineCameraEffects(dt, { camera, runTime, running: true, feel: cameraFeel });
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
            // The serene callout belongs to a freed animal only.
            if (callout.text !== 'IT DRIFTS ON, FREE' || matriarchDead) say(callout.text, callout.hold);
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
