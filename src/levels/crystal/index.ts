import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { CRYSTAL_BPM, CRYSTAL_WARDEN_DEFENSE_COUNT, createCrystalGameplay } from './gameplay';
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
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Boss beat callouts. Gameplay owns the fight; this just narrates it.
    const defenseIds = new Set<number>();
    let defensesSpawned = 0;
    let coreId = -1;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'warden-outer' || kind === 'warden-shield') {
        defenseIds.add(enemyId);
        defensesSpawned += 1;
      }
      if (kind === 'warden-core') {
        coreId = enemyId;
        say('CRYSTAL WARDEN', 2.6);
      }
    });
    bus.on('kill', ({ enemyId }) => {
      if (
        defenseIds.delete(enemyId)
        && defensesSpawned >= CRYSTAL_WARDEN_DEFENSE_COUNT
        && defenseIds.size === 0
      ) say('CORE EXPOSED', 2.6);
      if (enemyId === coreId) say('WARDEN DOWN', 3.2);
    });
    bus.on('runstart', () => {
      defenseIds.clear();
      defensesSpawned = 0;
      coreId = -1;
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
      level: createCrystalGameplay(bus),
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
        updateVisuals(dt, { scene, camera, elapsed });
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
