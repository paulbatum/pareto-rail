import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { CRYSTAL_DEBUG_TARGETS, normalizeCrystalDebugTarget } from './debug';
import { CRYSTAL_BPM, createCrystalGameplay } from './gameplay';
import { CRYSTAL_MARKERS, CRYSTAL_RUN_SECTIONS, CRYSTAL_TIME } from './timing';
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

export const crystalCorridorLevel: LevelDefinition = {
  id: 'crystal-corridor',
  title: 'Crystal Corridor',
  description: 'The neon crystal rail run — and now it shoots back.',
  bpm: CRYSTAL_BPM,
  markers: { ...CRYSTAL_MARKERS, warden: CRYSTAL_MARKERS.bossEntrance },
  sections: CRYSTAL_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: CRYSTAL_TIME.bar(section.fromBar),
  })),
  debugSelector: { queryParam: 'debugEnemy', label: 'Enemy', options: CRYSTAL_DEBUG_TARGETS },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Boss beat callouts. Gameplay owns the fight; this just narrates it.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('CRYSTAL WARDEN', 2.6);
      if (phase === 'exposed') say('CORE EXPOSED', 2.6);
      if (phase === 'destroyed') say('WARDEN DOWN', 3.2);
    });
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
      level: debugValue === undefined
        ? createCrystalGameplay(bus)
        : createCrystalGameplay(bus, normalizeCrystalDebugTarget(debugValue)),
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
        updateVisuals(dt, { scene, camera, feel, elapsed, runProgress: game.runProgress });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
