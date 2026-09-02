import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import {
  ASCENT_TIME,
  BOSS_TIME,
  FOREST_TIME,
  SERENITY_TIME,
  STRANDLINE_BARS,
  STRANDLINE_BPM,
  STRANDLINE_MARKERS,
  STRANDLINE_RUN_SECTIONS,
  STRANDLINE_TIME,
  VISTA_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironmentInternal,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineD9p1Level: LevelDefinition = {
  id: 'strandline-d9p1',
  title: 'Strandline',
  description:
    'Free a gigantic bioluminescent jellyfish from a toxic parasite infestation as your rail winds through its trailing tentacles to the crown.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x021622,
    bloom: { strength: 0.75, threshold: 0.45, radius: 0.55 },
    vignette: { inner: 0.35, outer: 1.1, strength: 0.65 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironmentInternal(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;

    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const timedCallouts = [
      { at: 1.2, text: 'OUTER STRANDS — PURGE INFESTATION', hold: 2.6 },
      { at: FOREST_TIME + 0.2, text: 'DEEP TENTACLE FOREST', hold: 2.4 },
      { at: VISTA_TIME + 0.1, text: 'THE BELL — BIOLUMINESCENT MOON', hold: 2.8 },
      { at: ASCENT_TIME + 0.2, text: 'ASCENDING ORAL ARMS', hold: 2.4 },
      { at: BOSS_TIME + 0.1, text: 'CROWN REACHED — SHATTER THE WEBBING', hold: 3.0 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 },
    ];
    let nextCallout = 0;

    let parentSeen = false;
    let animalFreed = false;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') {
        say('WEBBING SHATTERED — TEAR PARENT LOOSE', 3.0);
      } else if (phase === 'destroyed') {
        animalFreed = true;
        say('INFESTATION PURGED — ANIMAL SERENE', 3.8);
      }
    });

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      parentSeen = false;
      animalFreed = false;
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
        updateCameraEffects({ camera, runTime, dt }) {
          updateStrandlineCameraEffects(dt, { camera, runTime, running: true, feel: cameraFeel });
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
        const running = game.state === 'running';
        if (running) {
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
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          running,
          feel: cameraFeel,
        });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
        disposeVisuals();
      },
    };
  },
};
