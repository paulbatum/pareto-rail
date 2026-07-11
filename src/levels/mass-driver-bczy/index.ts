import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { MASS_DRIVER_BCZY_BPM, MASS_DRIVER_BCZY_MARKERS, MASS_DRIVER_BCZY_TIME, massDriverBczyGameplay } from './gameplay';
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

export const massDriverBczyLevel: LevelDefinition = {
  id: 'mass-driver-bczy',
  title: 'Mass Driver',
  description: 'Ride an accelerating electric mass driver and clear its jammed interlocks before launch.',
  bpm: MASS_DRIVER_BCZY_BPM,
  markers: MASS_DRIVER_BCZY_MARKERS,
  sections: [
    { name: 'injection', time: MASS_DRIVER_BCZY_TIME.bar(0) }, { name: 'blue bank', time: MASS_DRIVER_BCZY_TIME.bar(8) },
    { name: 'violet bank', time: MASS_DRIVER_BCZY_TIME.bar(16) }, { name: 'jammed interlocks', time: MASS_DRIVER_BCZY_TIME.bar(24) },
  ],
  post: {
    clearColor: 0x01010a,
    bloom: { strength: 1.05, threshold: 0.62, radius: 0.18 },
    vignette: { inner: 0.35, outer: 1.12, strength: 0.72 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let announcedInterlocks = false;
    let calloutUntil = 0;
    let interlocksCleared = 0;
    const liveInterlocks = new Set<number>();
    bus.on('runstart', () => {
      runTime = 0;
      announcedInterlocks = false;
      calloutUntil = 2.4;
      interlocksCleared = 0;
      liveInterlocks.clear();
      hud.setCallout('INJECTION COILS ONLINE');
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') liveInterlocks.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!liveInterlocks.delete(enemyId)) return;
      interlocksCleared += 1;
      if (interlocksCleared === 8) bus.emit('bossphase', { phase: 'destroyed' });
    });
    bus.on('runend', ({ died }) => {
      hud.setCallout(!died && interlocksCleared === 8 ? 'INTERLOCKS CLEAR — LAUNCH' : 'INTERLOCK JAM — BARREL DETONATION');
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
      level: massDriverBczyGameplay,
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
        if (game.state === 'running') {
          runTime += dt;
          if (!announcedInterlocks && runTime >= MASS_DRIVER_BCZY_MARKERS.interlocks) {
            announcedInterlocks = true;
            calloutUntil = runTime + 3.5;
            hud.setCallout('SAFETY INTERLOCKS JAMMED — CLEAR THE ARRAY');
            bus.emit('bossphase', { phase: 'summoned' });
          }
          if (calloutUntil > 0 && runTime >= calloutUntil) {
            calloutUntil = 0;
            hud.setCallout('');
          }
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
