import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  VESPERS_BPM,
  VESPERS_MARKERS,
  VESPERS_RUN_SECTIONS,
  VESPERS_TIME,
  createVespersGameplay,
} from './gameplay';
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

export const vespersJ7xpLevel: LevelDefinition = {
  id: 'vespers-j7xp',
  title: 'Vespers',
  description: 'Fly the nave of a massive cathedral at night, winning back the light of its stained glass from shadow creatures.',
  bpm: VESPERS_BPM,
  markers: VESPERS_MARKERS,
  sections: VESPERS_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: VESPERS_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x000005,
    bloom: { strength: 0.65, threshold: 0.65, radius: 0.15 },
    vignette: { inner: 0.35, outer: 1.0, strength: 0.5 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE OCULUS EATER', 2.8);
      if (phase === 'destroyed') say('ROSE WINDOW IGNITED', 3.5);
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
      level: createVespersGameplay(bus),
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
        updateVisuals(dt, elapsed, camera);
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
