import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createVespersGameplay, VESPERS_BPM } from './gameplay';
import { VESPERS_MARKERS, VESPERS_RUN_SECTIONS, VESPERS_TIME } from './timing';
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
import { composeVespersOutput } from './visuals/post-fx';

export const vespersT5xwLevel: LevelDefinition = {
  id: 'vespers-t5xw',
  title: 'Vespers',
  description: 'Night in a vast cathedral: win its stolen window-light back, pane by pane.',
  bpm: VESPERS_BPM,
  markers: { ...VESPERS_MARKERS },
  sections: VESPERS_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: VESPERS_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x07070c,
    bloom: { strength: 1.0, threshold: 0.55, radius: 0.22 },
    vignette: { inner: 0.28, outer: 1.08, strength: 0.68 },
    composeOutput: composeVespersOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Boss narration: gameplay owns the fight; this only names its beats.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE VIGIL', 2.6);
      if (phase === 'exposed') say('THE HEART IS BARE', 2.4);
      if (phase === 'destroyed') say('LIGHT RETURNS', 3.4);
    });
    bus.on('playerhit', () => {
      feel.shake(0.55);
    });
    bus.on('volley', ({ size, kills }) => {
      if (kills >= 4 && kills >= size) feel.kickFov(2.2);
    });
    bus.on('kill', () => {
      feel.kickFov(0.35, { decay: 6 });
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') {
        feel.kickFov(4.5, { decay: 2.2 });
        feel.shake(0.4);
      }
    });
    bus.on('runstart', () => {
      calloutUntil = -1;
      hud.setCallout('');
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
