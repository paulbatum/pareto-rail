import type { PerspectiveCamera } from 'three';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import {
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
  updateAttractCamera as updateStrandlineAttractCamera,
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineS3vnLevel: LevelDefinition = {
  id: 'strandline-s3vn',
  title: 'Strandline',
  description: 'Fly the trailing strands of a colossal jellyfish and cut a violet infestation off it.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x030d1f,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius slot
    // and `radius` into the luminance threshold slot; these values are chosen
    // for that mapping. Effective radius 0.16, effective luminance threshold
    // 0.62 — the water sits near 0.25, so bloom only ever touches bioluminescent
    // cores and player fire. A wide radius here smears the bell across the whole
    // frame and the level loses its blacks.
    bloom: { strength: 0.85, threshold: 0.16, radius: 0.62 },
    vignette: { inner: 0.3, outer: 1.06, strength: 0.8 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration. Gameplay owns the fight; this only watches the clock and the
    // bus, and it exists so the run reads as a rescue rather than a shooting
    // gallery — you are being told what is wrong with the animal.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: STRANDLINE_MARKERS.open - 1.6, text: 'THE BELL', hold: 2.4 },
      { at: STRANDLINE_MARKERS.dive + 0.2, text: 'BACK INTO THE STRANDS', hold: 2.0 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let parentDown = false;
    let firstStinger = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'parent') say('THE PARENT — DUG INTO THE CROWN', 3.0);
      if (kind === 'stinger' && !firstStinger) {
        firstStinger = true;
        say('SPITTERS — CUT THE SPORES DOWN', 2.6);
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned' && !parentDown) say('IT IS FEEDING THE WEBBING', 2.2);
      if (phase === 'exposed' && !parentDown) say('WEBBING DEAD — TEAR IT LOOSE', 2.2);
      if (phase === 'destroyed') {
        parentDown = true;
        say('THE COLONY IS OFF', 3.4);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      parentDown = false;
      firstStinger = false;
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
        updateAttractCamera({ camera: attractCamera, modeTime }) {
          updateStrandlineAttractCamera(attractCamera as PerspectiveCamera, modeTime);
        },
        updateCameraEffects({ camera: runCamera, runTime: currentRunTime, dt }) {
          updateStrandlineCameraEffects(dt, { camera: runCamera, runTime: currentRunTime, running: true, feel: cameraFeel });
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
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running', feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
