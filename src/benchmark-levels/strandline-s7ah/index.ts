import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import { CROWN_TIME, RELEASE_TIME, REVEAL_TIME, STRANDLINE_BPM, STRANDLINE_MARKERS, STRANDLINE_RUN_SECTIONS, STRANDLINE_TIME, THICK_TIME } from './timing';
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

export const strandlineS7ahLevel: LevelDefinition = {
  id: 'strandline-s7ah',
  title: 'Strandline',
  description: 'Free a gigantic jellyfish from its parasite infestation, strand by glowing strand.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x03141c,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius
    // slot and `radius` into the luminance threshold slot; these values are
    // chosen for that mapping. The water column stays under ~0.5 luminance,
    // so an effective threshold of 0.55 keeps bloom on the bioluminescence.
    bloom: { strength: 0.85, threshold: 0.35, radius: 0.55 },
    vignette: { inner: 0.32, outer: 1.1, strength: 0.78 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the swim's waypoints get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: REVEAL_TIME + STRANDLINE_TIME.bar(1.7), text: 'THE BELL', hold: 2.2 },
      { at: THICK_TIME + 0.1, text: 'BACK INTO THE STRANDS', hold: 2.0 },
      { at: CROWN_TIME - 1.8, text: 'THE CROWN — SOMETHING IS DUG IN', hold: 2.2 },
      { at: RELEASE_TIME + 1.0, text: '', hold: 0 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let spitterSeen = false;
    let matriarchFreed = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'spitter' && !spitterSeen) {
        spitterSeen = true;
        say('SPITTER — SHOOT DOWN ITS VENOM', 2.6);
      }
      if (kind === 'matriarch') say('THE MATRIARCH — KILL THE BROODS TO STARVE ITS WEB', 3.2);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('WEB DOWN — TEAR IT LOOSE', 2.6);
      if (phase === 'destroyed') {
        matriarchFreed = true;
        say('IT LETS GO — THE ANIMAL WAKES', 3.6);
      }
    });
    bus.on('runend', () => {
      if (matriarchFreed) hud.setCallout('');
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      spitterSeen = false;
      matriarchFreed = false;
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
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running', feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
