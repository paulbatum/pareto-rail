import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { SPEEDSOLVE_BPM, createSpeedsolveGameplay } from './gameplay';
import { SS_MARKERS, SS_RUN_SECTIONS, SS_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';
import { SOLVE_COLOR_NAMES, VOID_FOG } from './visuals/palette';
import { composeSpeedsolveOutput } from './visuals/post-fx';

const SPEEDSOLVE_SHAKE = { decay: 2.4, pitchDegrees: 0.3, yawDegrees: 0.26, rollDegrees: 0.6, frequency: 10 };

export const speedsolveN4v0Level: LevelDefinition = {
  id: 'speedsolve-n4v0',
  title: 'Speedsolve',
  description: 'One boss, six faces: orbit a colossal puzzle cube, shoot the wrong stickers so every kill snaps a layer on the beat, tear off the solved faces, and burst the core.',
  bpm: SPEEDSOLVE_BPM,
  markers: SS_MARKERS,
  sections: SS_RUN_SECTIONS.map((section) => ({ name: section.name, time: SS_TIME.bar(section.fromBar) })),
  post: {
    clearColor: VOID_FOG.getHex(),
    // A pale void: bloom must only catch HDR whites and lit stickers, never the
    // sky. Note the shared post pass hands these two fields to three's bloom()
    // in (radius, threshold) order, so the effective threshold is the `radius`
    // value here (0.92) and the effective radius is `threshold` (0.24).
    bloom: { strength: 0.55, threshold: 0.24, radius: 0.92 },
    vignette: { inner: 0.42, outer: 1.18, strength: 0.42 },
    composeOutput: composeSpeedsolveOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    const gameplay = createSpeedsolveGameplay(bus);
    const { fight } = gameplay;
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, fight);

    // Callouts narrate the solve like a cube timer. Gameplay owns the fight.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('runstart', () => {
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
        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          running: game.state === 'running',
          pose: gameplay.pose(),
          onEvent(event) {
            switch (event.type) {
              case 'window':
                say(`FACE ${event.window + 1} · ${SOLVE_COLOR_NAMES[event.face]}`, 1.6);
                break;
              case 'fall':
                say('FACE SOLVED — HUB EXPOSED', 1.8);
                break;
              case 'hub': {
                if (event.phase !== 'kill') break;
                const splits = fight.splits();
                const split = splits[splits.length - 1];
                say(split === undefined ? 'HUB DOWN' : `HUB DOWN · ${split.toFixed(2)}s`, 2);
                break;
              }
              case 'shell':
                say('SHELL OPEN — CORE EXPOSED', 2.4);
                break;
              case 'core':
                if (event.phase === 'cage') say('HEART BARE', 1.8);
                if (event.phase === 'kill') say(`SOLVED · ${fight.facesSolved()}/6 FACES`, 3.5);
                if (event.phase === 'escape') say('CORE ESCAPED', 3);
                break;
              default:
                break;
            }
          },
        });
        feel.update(dt, { shake: SPEEDSOLVE_SHAKE });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
