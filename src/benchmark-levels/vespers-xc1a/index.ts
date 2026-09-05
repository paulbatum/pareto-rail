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
  previewIgnition,
  setReticleActive,
  updateCameraEffects,
  updateVisuals,
} from './visuals';
import { composeVespersOutput } from './visuals/post-fx';

export const vespersLevel: LevelDefinition = {
  id: 'vespers-xc1a',
  title: 'Vespers',
  description: 'Fly the nave of a cathedral at night and take its light back from the thing eating it.',
  bpm: VESPERS_BPM,
  markers: VESPERS_MARKERS,
  sections: VESPERS_RUN_SECTIONS.map((section) => ({ name: section.name, time: VESPERS_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x010102,
    bloom: { strength: 0.95, threshold: 0.62, radius: 0.22 },
    vignette: { inner: 0.28, outer: 1.05, strength: 0.72 },
    composeOutput: composeVespersOutput,
  },
  // Inspection only: `?debugScene=lit` starts the run with the rose already
  // ignited so the lit cathedral can be reviewed without fighting the eye.
  debugSelector: { queryParam: 'debugScene', label: 'Scene', options: [{ id: 'lit', title: 'Lit cathedral' }] },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);
    if (debugValue === 'lit') bus.on('runstart', () => previewIgnition(feel));

    // Callouts narrate the rose. Gameplay owns the fight; this only reads the bus.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE ROSE WINDOW', 2.8);
      if (phase === 'exposed') say('THE EYE OPENS', 2.4);
      if (phase === 'destroyed') say('LIGHT RETURNS', 3.6);
    });
    bus.on('runstart', () => {
      calloutUntil = -1;
      hud.setCallout('');
    });

    const gameplay = createVespersGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: {
        ...gameplay,
        updateCameraEffects({ camera: runCamera, runTime, dt }) {
          updateCameraEffects(dt, { camera: runCamera, runTime, running: true, feel });
        },
      },
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
        updateVisuals(dt, { scene, camera, elapsed, running: game.state === 'running', attract: game.state === 'attract', runProgress: game.runProgress, feel });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
