import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  createThermalInk8448Gameplay,
  THERMAL_INK_8448_BPM,
  THERMAL_INK_8448_MARKERS,
  THERMAL_INK_8448_RUN_DURATION,
  THERMAL_INK_8448_RUN_SECTIONS,
} from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  isInfraredMode,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  toggleInfraredMode,
  updateVisuals,
} from './visuals';

export const thermalInk8448Level: LevelDefinition = {
  id: 'thermal-ink-8448',
  title: 'Thermal Ink',
  description: 'A sodium-harbor boss fight where an ink blackout reveals the octopus in infrared.',
  bpm: THERMAL_INK_8448_BPM,
  markers: THERMAL_INK_8448_MARKERS,
  sections: THERMAL_INK_8448_RUN_SECTIONS.map((section) => ({ name: section.name, time: section.fromBar * (THERMAL_INK_8448_RUN_DURATION / 27) })),
  post: {
    clearColor: 0x050403,
    bloom: { strength: 0.42, threshold: 0.78, radius: 0.12 },
    vignette: { inner: 0.28, outer: 1.02, strength: 0.58 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let now = 0;
    let calloutUntil = -1;
    const inkIds = new Set<number>();
    const say = (message: string, duration: number) => {
      hud.setCallout(message);
      calloutUntil = now + duration;
    };
    const offRunStart = bus.on('runstart', () => {
      inkIds.clear();
      calloutUntil = -1;
    });
    const offSpawn = bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'ink-cloud') {
        inkIds.add(enemyId);
        say('INK BLACKOUT // INFRARED', 2.5);
      }
    });
    const offMiss = bus.on('miss', ({ enemyId }) => {
      if (inkIds.delete(enemyId)) say('SIGHT RESTORED', 1.4);
    });
    const offBoss = bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('CONTACT // MUTANT OCTOPUS', 2.6);
      if (phase === 'exposed') say('CORE EXPOSED', 2.4);
      if (phase === 'destroyed') say('HARBOR LAMPS RETURN', 3.2);
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'i') return;
      toggleInfraredMode();
      say(isInfraredMode() ? 'INFRARED MANUAL' : 'SODIUM SIGHT', 1.1);
    };
    window.addEventListener('keydown', onKeyDown);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: createThermalInk8448Gameplay(bus),
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
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runProgress: game.runProgress });
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
      },
      dispose() {
        offRunStart();
        offSpawn();
        offMiss();
        offBoss();
        window.removeEventListener('keydown', onKeyDown);
        game.dispose();
      },
    };
  },
};
