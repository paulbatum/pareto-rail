import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import {
  CROWN_TIME,
  OPEN_TIME,
  RISE_TIME,
  STRANDLINE_BPM,
  STRANDLINE_MARKERS,
  STRANDLINE_RUN_SECTIONS,
  STRANDLINE_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineOs1aLevel: LevelDefinition = {
  id: 'strandline-os1a',
  title: 'Strandline',
  description: 'Cut an infestation off a gigantic jellyfish, threading the rail through its trailing strands.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x07191f,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius slot
    // and `radius` into the luminance threshold slot; these values are chosen
    // for that mapping. The water sits well below 0.5 luminance, so an
    // effective threshold of 0.55 keeps bloom on photophores and player fire.
    bloom: { strength: 0.72, threshold: 0.4, radius: 0.62 },
    vignette: { inner: 0.3, outer: 1.12, strength: 0.8 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration. Gameplay owns the fight; this only watches the clock and the
    // bus, and it stays quiet through both wide swings — the view is supposed
    // to be the only thing talking there.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: OPEN_TIME - 1.2, text: 'CLEAR OF THE STRANDS', hold: 2.0 },
      { at: RISE_TIME + 0.2, text: 'FOLLOWING THEM UP', hold: 2.2 },
      { at: CROWN_TIME - 0.6, text: 'THE CROWN', hold: 2.0 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let spitterSeen = false;
    let broodSeen = false;
    let parentDown = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'spitter' && !spitterSeen) {
        spitterSeen = true;
        say('SPITTER — INTERCEPT THE SPORES', 2.6);
      }
      if (kind === 'brood' && !broodSeen) {
        broodSeen = true;
        say('BROOD — KILL IT TO STARVE THE WEBBING', 2.8);
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('PARENT DUG INTO THE CROWN', 2.8);
      if (phase === 'exposed') say('WEBBING DEAD — TEAR IT LOOSE', 2.8);
      if (phase === 'destroyed' && !parentDown) {
        parentDown = true;
        say('THE COLONY IS CLEAN', 3.4);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      spitterSeen = false;
      broodSeen = false;
      parentDown = false;
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
      level: {
        ...createStrandlineGameplay(bus),
        updateCameraEffects({ camera: runCamera, runTime: cameraRunTime, dt }) {
          updateStrandlineCameraEffects(dt, { camera: runCamera, runTime: cameraRunTime, running: true, feel: cameraFeel });
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
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < timedCallouts.length - 1 && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running', feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
