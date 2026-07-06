import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { DELUGE_DEBUG_TARGETS, normalizeDelugeDebugTarget } from './debug';
import { createDelugeGameplay, DELUGE_BPM } from './gameplay';
import { composeDelugeOutput } from './post-fx';
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
  updateCameraEffects,
  updateVisuals,
} from './visuals';

export const delugeLevel: LevelDefinition = {
  id: 'deluge',
  title: 'Deluge',
  description: 'Escape a rain-lashed neon megacity with the city’s hunter-gunship on your tail.',
  bpm: DELUGE_BPM,
  aliases: ['deluge'],
  debugSelector: { queryParam: 'debugEnemy', label: 'Enemy', options: DELUGE_DEBUG_TARGETS },
  post: {
    clearColor: 0x050914,
    bloom: { strength: 0.95, threshold: 0.55, radius: 0.18 },
    vignette: { inner: 0.32, outer: 1.08, strength: 0.72 },
    composeOutput: composeDelugeOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('runstart', () => {
      runTime = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') say('VULTURE DOWN — CLIMB', 4.0);
      if (phase === 'exposed') say('BEAM HIT — LAST WINDOW', 2.6);
    });

    const gameplay = debugValue === undefined
      ? createDelugeGameplay(bus)
      : createDelugeGameplay(bus, normalizeDelugeDebugTarget(debugValue));
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
        updateAttractCamera,
        updateCameraEffects({ camera, runTime, dt }) {
          updateCameraEffects(dt, { camera, runTime, running: true, dt });
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
        if (game.state === 'running') runTime += dt;
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running' });
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
