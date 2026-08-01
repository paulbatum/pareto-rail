import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createVespersGameplay, VESPERS_BPM } from './gameplay';
import { VESPERS_MARKERS, VESPERS_RUN_SECTIONS, VESPERS_TIME } from './timing';
import { composeVespersOutput } from './visuals/post-fx';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects,
  updatePostUniforms,
  updateVisuals,
} from './visuals';

export const vespers8qvgLevel: LevelDefinition = {
  id: 'vespers-8qvg',
  title: 'Vespers',
  description:
    'Fly the nave of a cathedral at night while something eats the light out of it. Flat black shapes come off the glass with a stolen pane\u2019s colour burning in their chest \u2014 kill them and the windows come back, until the Devourer in the dead rose window breaks open and the whole building ignites.',
  bpm: VESPERS_BPM,
  markers: { ...VESPERS_MARKERS },
  sections: VESPERS_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: VESPERS_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x000006,
    bloom: { strength: 0.65, threshold: 0.55, radius: 0.55 },
    vignette: { inner: 0.4, outer: 1.0, strength: 0.6 },
    composeOutput: composeVespersOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    // Boss beat callouts. Gameplay owns the fight; this just narrates it.
    let calloutUntil = -1;
    let runTime = 0;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE DEVOURER', 2.6);
      if (phase === 'exposed') say('THE HEART IS OPEN', 2.6);
      if (phase === 'destroyed') say('THE ROSE IGNITES', 3.4);
    });
    bus.on('runstart', () => {
      calloutUntil = -1;
      runTime = 0;
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
        if (game.state === 'running') runTime += dt;
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        const running = game.state === 'running';
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runProgress: game.runProgress,
          running,
          feel,
        });
        updateCameraEffects(dt, {
          camera,
          runTime,
          running,
          feel,
        });
        updatePostUniforms(dt);
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
