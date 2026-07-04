import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createCrystalGameplay } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const crystalCorridorLevel: LevelDefinition = {
  id: 'crystal-corridor',
  title: 'Crystal Corridor',
  description: 'The neon crystal rail run — and now it shoots back.',
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Boss beat callouts. Gameplay owns the fight; this just narrates it.
    const shieldIds = new Set<number>();
    let coreId = -1;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'warden-shield') shieldIds.add(enemyId);
      if (kind === 'warden-core') {
        coreId = enemyId;
        say('PRISM WARDEN', 2.6);
      }
    });
    bus.on('kill', ({ enemyId }) => {
      if (shieldIds.delete(enemyId) && shieldIds.size === 0) say('CORE EXPOSED', 2.6);
      if (enemyId === coreId) say('WARDEN DOWN', 3.2);
    });
    bus.on('runstart', () => {
      shieldIds.clear();
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
