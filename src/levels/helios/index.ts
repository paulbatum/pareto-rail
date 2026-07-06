import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BOSS_TIME, CORONA_TIME, createHeliosGameplay, GATE_TIME, HELIOS_BPM, REVEAL_TIME } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateHeliosCameraEffects,
  updateVisuals,
} from './visuals';
import { composeHeliosOutput } from './visuals/post-fx';

export const heliosLevel: LevelDefinition = {
  id: 'helios',
  title: 'Helios',
  description: 'Dive into a dying star and kill the thing that is eating it.',
  bpm: HELIOS_BPM,
  post: {
    clearColor: 0x070204,
    bloom: { strength: 1.2, threshold: 0.52, radius: 0.2 },
    vignette: { inner: 0.36, outer: 1.1, strength: 0.78 },
    composeOutput: composeHeliosOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Narration: the run's set pieces get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: GATE_TIME - 2.2, text: 'THE LAST GATE', hold: 2.0 },
      { at: CORONA_TIME - 0.2, text: 'CORONA DIVE', hold: 2.4 },
      { at: REVEAL_TIME, text: 'IT RISES', hold: 2.6 },
      { at: BOSS_TIME + 118, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    const fangIds = new Set<number>();
    let heartId = -1;
    let heartSpawned = false;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'fang') fangIds.add(enemyId);
      if (kind === 'heart') {
        heartId = enemyId;
        heartSpawned = true;
        say('THE SUNEATER', 3.0);
      }
    });
    bus.on('kill', ({ enemyId }) => {
      if (fangIds.delete(enemyId) && fangIds.size === 0 && heartSpawned) say('HEART EXPOSED', 2.4);
      if (enemyId === heartId) say('SUNEATER SLAIN — OUTRUN THE LIGHT', 4.0);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      fangIds.clear();
      heartId = -1;
      heartSpawned = false;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const heliosGameplay = createHeliosGameplay(bus);
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
        ...heliosGameplay,
        updateCameraEffects({ camera, runTime, dt }) {
          updateHeliosCameraEffects(dt, { camera, runTime, running: true });
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
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running' });
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
