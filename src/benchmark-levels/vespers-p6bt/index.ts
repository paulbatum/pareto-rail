import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import type { LevelDefinition } from '../../engine/types';
import { createAudio } from './audio';
import { VESPERS_BPM, createVespersGameplay } from './gameplay';
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

export const vespersLevel: LevelDefinition = {
  id: 'vespers-p6bt',
  title: 'Vespers',
  description: 'Night in a cathedral that is being drunk of its light. Win the windows back.',
  bpm: VESPERS_BPM,
  markers: { ...VESPERS_MARKERS, boss: VESPERS_MARKERS.roseEntrance },
  sections: VESPERS_RUN_SECTIONS.map((section) => ({ name: section.name, time: VESPERS_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x000000,
    // The frame is nearly all black, so bloom can be generous: it only ever
    // finds glass, candles and the player's own marks.
    bloom: { strength: 0.75, threshold: 0.55, radius: 0.45 },
    vignette: { inner: 0.2, outer: 0.98, strength: 0.85 },
    composeOutput: composeVespersOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // The fight narrates itself; gameplay owns everything it is describing.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE DEAD ROSE', 2.8);
      if (phase === 'exposed') say('BREAK IT OPEN', 2.6);
      if (phase === 'destroyed') say('LET THERE BE LIGHT', 4);
    });
    // The room answers physically: a kick of trauma for the biggest events.
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') feel.shake(0.9, { decay: 0.8 });
      if (phase === 'exposed') feel.shake(0.35);
    });
    bus.on('playerhit', () => feel.shake(0.55));
    bus.on('stage', () => feel.shake(0.28));
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
        updateVisuals(dt, { scene, camera, feel, elapsed });
        feel.update(dt, { shake: { rollDegrees: 1.1, pitchDegrees: 0.4, yawDegrees: 0.32, frequency: 7 } });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};

export default vespersLevel;
