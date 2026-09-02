import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  createStrandlineGameplay,
  STRANDLINE_BPM,
  strandlineRunProgress,
} from './gameplay';
import {
  bar,
  STRANDLINE_MARKERS,
  STRANDLINE_RUN_SECTIONS,
  STRANDLINE_TIME,
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

export const strandlineU5oaLevel: LevelDefinition = {
  id: 'strandline-u5oa',
  title: 'Strandline',
  description: 'Thread the bioluminescent tentacles of a colossal jellyfish, purge its parasitic infestation, and free the creature.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x010a14,
    bloom: { strength: 0.68, threshold: 0.72, radius: 0.12 },
    vignette: { inner: 0.3, outer: 1.05, strength: 0.65 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let now = 0;
    let clearCalloutAt = -1;
    let calloutIndex = 0;

    const callouts = [
      { at: bar(1), text: 'PARASITIC INFESTATION DETECTED' },
      { at: bar(6), text: 'THREADING THE STRAND FOREST' },
      { at: bar(14), text: 'THE BELL — TITAN MEDUSA' },
      { at: bar(20), text: 'THE CROWN — PURGE THE BROODS' },
      { at: bar(24.5), text: 'WEB LATTICE COLLAPSED — TEAR THE QUEEN LOOSE' },
      { at: bar(26.5), text: 'PURIFIED • SERENE DRIFT' },
    ];

    const say = (text: string, hold = 2.4) => {
      hud.setCallout(text);
      clearCalloutAt = now + hold;
    };

    bus.on('runstart', () => {
      runTime = 0;
      calloutIndex = 0;
      clearCalloutAt = -1;
      hud.setCallout('');
    });

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('PARENT ORGANISM AT THE CROWN', 2.0);
      else if (phase === 'exposed') say('QUEEN CORE EXPOSED — DESTROY IT', 2.5);
      else if (phase === 'destroyed') say('THE TITAN MEDUSA IS FREE', 4.0);
    });

    const gameplay = createStrandlineGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip: `${startTip} • Sweep across tentacles. Intercept toxic spore bolts.`,
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
        now = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (calloutIndex < callouts.length && runTime >= callouts[calloutIndex].at) {
            say(callouts[calloutIndex].text);
            calloutIndex += 1;
          }
        }
        if (clearCalloutAt >= 0 && elapsed >= clearCalloutAt) {
          hud.setCallout('');
          clearCalloutAt = -1;
        }

        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          runProgress: strandlineRunProgress(runTime),
          running: game.state === 'running',
        });
      },
      dispose() {
        game.dispose();
        disposeVisuals();
        hud.setCallout('');
      },
    };
  },
};
