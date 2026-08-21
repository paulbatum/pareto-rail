import { vec4 } from 'three/tsl';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createVespersGameplay } from './gameplay';
import { VESPERS_BPM } from './timing';
import { VESPERS_MARKERS, VESPERS_RUN_SECTIONS, VESPERS_TIME } from './timing';
import { flashColor, flashStrength } from './visuals';
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

export const vespers1izgLevel: LevelDefinition = {
  id: 'vespers-1izg',
  title: 'Vespers',
  description:
    'Fly the nave of a night cathedral while something eats its light. Kill the thieves and the windows they stripped come back burning — then break open the rose.',
  bpm: VESPERS_BPM,
  markers: { ...VESPERS_MARKERS, rose: VESPERS_MARKERS.rose },
  sections: VESPERS_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: VESPERS_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x010103,
    bloom: { strength: 0.6, threshold: 0.72, radius: 0.12 },
    vignette: { inner: 0.24, outer: 1.0, strength: 0.62 },
    composeOutput: ({ base }) =>
      base.add(vec4(flashColor, 0).mul(flashStrength)),
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE DEVOURER', 2.6);
      if (phase === 'exposed') say('THE HEART IS BARED', 2.6);
      if (phase === 'destroyed') {
        say('THE ROSE IGNITES', 3.4);
        feel.kickFov(4.5);
        feel.shake(1);
      }
    });
    bus.on('volley', ({ kills }) => {
      if (kills >= 4) feel.kickFov(1.1);
    });
    bus.on('playerhit', () => {
      feel.shake(0.55);
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
