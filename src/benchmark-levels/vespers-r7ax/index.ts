import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createVespersR7axGameplay } from './gameplay';
import {
  VESPERS_R7AX_BPM,
  VESPERS_R7AX_MARKERS,
  VESPERS_R7AX_RUN_SECTIONS,
  VESPERS_R7AX_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  forceIlluminationTableau,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const vespersR7axLevel: LevelDefinition = {
  id: 'vespers-r7ax',
  title: 'Vespers',
  description: 'Steal the cathedral’s stained light back from the dark.',
  bpm: VESPERS_R7AX_BPM,
  markers: VESPERS_R7AX_MARKERS,
  sections: VESPERS_R7AX_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: VESPERS_R7AX_TIME.bar(section.fromBar),
  })),
  debugSelector: {
    queryParam: 'vespersScene',
    label: 'Scene',
    options: [{ id: 'illumination', title: 'Illuminated cathedral' }],
  },
  post: {
    clearColor: 0x010104,
    bloom: { strength: 0.92, threshold: 0.62, radius: 0.16 },
    vignette: { inner: 0.28, outer: 1.04, strength: 0.84 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextTimedCallout = 0;
    const timedCallouts = [
      { at: VESPERS_R7AX_MARKERS.tenebrae, text: 'TENEBRAE', hold: 2.8 },
      { at: VESPERS_R7AX_MARKERS.rose - 0.35, text: 'THE DEAD ROSE', hold: 3.0 },
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
      if (phase === 'summoned') say('THE LIGHT-EATER', 2.6);
      if (phase === 'exposed') say('BREAK IT OPEN', 2.4);
      if (phase === 'destroyed') say('LUX REDDIT — THE LIGHT RETURNS', 4.5);
    });

    const gameplay = createVespersR7axGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: gameplay,
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
          if (debugValue === 'illumination' && runTime >= 55.45) {
            forceIlluminationTableau();
          }
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
          runProgress: game.runProgress,
        });
        feel.update(dt);
      },
      dispose() {
        game.dispose();
        feel.dispose();
        disposeVisuals();
      },
    };
  },
};
