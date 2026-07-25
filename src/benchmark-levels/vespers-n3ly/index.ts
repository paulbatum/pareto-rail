import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createVespersN3lyGameplay } from './gameplay';
import {
  VESPERS_N3LY_BPM,
  VESPERS_N3LY_MARKERS,
  VESPERS_N3LY_RUN_SECTIONS,
  VESPERS_N3LY_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const vespersN3lyLevel: LevelDefinition = {
  id: 'vespers-n3ly',
  title: 'Vespers',
  description: 'Steal the light back from a midnight cathedral, pane by pane.',
  bpm: VESPERS_N3LY_BPM,
  markers: VESPERS_N3LY_MARKERS,
  sections: VESPERS_N3LY_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: VESPERS_N3LY_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x010106,
    bloom: { strength: 1.05, threshold: 0.62, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.84 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextTimedCallout = 0;
    const timedCallouts = [
      { at: VESPERS_N3LY_MARKERS.silence + 0.3, text: 'THE NAVE HOLDS ITS BREATH', hold: 3.3 },
      { at: VESPERS_N3LY_MARKERS.rose - 0.5, text: 'THE DEAD ROSE', hold: 2.8 },
    ];
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + seconds;
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextTimedCallout = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE DEVOURER', 2.5);
      if (phase === 'exposed') say('BREAK THE HUNGER', 2.4);
      if (phase === 'destroyed') say('LUX AETERNA', 4.8);
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
      level: createVespersN3lyGameplay(bus),
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
        elapsedNow = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (nextTimedCallout < timedCallouts.length && runTime >= timedCallouts[nextTimedCallout].at) {
            const callout = timedCallouts[nextTimedCallout];
            say(callout.text, callout.hold);
            nextTimedCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          runTime,
          running: game.state === 'running',
        });
      },
      dispose() {
        game.dispose();
        disposeVisuals();
        feel.dispose();
      },
    };
  },
};
