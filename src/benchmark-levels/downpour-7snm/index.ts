import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { DOWNPOUR_7SNM_BPM, DOWNPOUR_7SNM_TIME, DOWNPOUR_MARKERS, downpour7snmGameplay } from './gameplay';
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

export const downpour7snmLevel: LevelDefinition = {
  id: 'downpour-7snm',
  title: 'Downpour',
  description: 'Run a hunted courier through a rain-lashed neon megacity and outrun its acid-green gunship.',
  bpm: DOWNPOUR_7SNM_BPM,
  markers: DOWNPOUR_MARKERS,
  sections: [
    { name: 'Storm Ceiling', time: 0 },
    { name: 'Tower Plunge', time: DOWNPOUR_7SNM_TIME.bar(4) },
    { name: 'Undercity', time: DOWNPOUR_7SNM_TIME.bar(20) },
    { name: 'Hunter', time: DOWNPOUR_7SNM_TIME.bar(28) },
    { name: 'Cloudbreak', time: DOWNPOUR_7SNM_TIME.bar(42) },
  ],
  post: {
    clearColor: 0x030812,
    bloom: { strength: 0.9, threshold: 0.68, radius: 0.14 },
    vignette: { inner: 0.28, outer: 1.05, strength: 0.68 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: downpour7snmGameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    let elapsed = 0;
    let runTime = 0;
    const calls = [[4, 'DROP'], [20, 'UNDERCITY'], [28, 'HUNTER SIGNAL'], [34, 'CITADEL'], [42, 'CLOUDBREAK']] as const;
    let nextCall = 0;
    bus.on('runstart', () => { runTime = 0; nextCall = 0; hud.setCallout('ROUTE 07 — RUN'); });
    return {
      update(dt, now) {
        elapsed = now;
        if (game.state === 'running') {
          runTime += dt;
          if (nextCall < calls.length && runTime >= DOWNPOUR_7SNM_TIME.bar(calls[nextCall][0])) hud.setCallout(calls[nextCall++][1]);
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
