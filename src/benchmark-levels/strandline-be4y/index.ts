import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import { BROOD_SIZE } from './parent';
import {
  BELL_TIME,
  CROWN_TIME,
  DEADLINE_TIME,
  STRANDLINE_BPM,
  STRANDLINE_MARKERS,
  STRANDLINE_RUN_SECTIONS,
  STRANDLINE_TIME,
  bar,
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
  updateAttractCamera,
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineBe4yLevel: LevelDefinition = {
  id: 'strandline-be4y',
  title: 'Strandline',
  description: 'Free a gigantic jellyfish from the parasites clamped to its strands, and tear their Parent loose from its crown.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x030f1e,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius
    // slot and `radius` into the luminance threshold slot; these values are
    // chosen for that mapping. Sunlit water peaks near 0.5 luminance, so the
    // effective threshold of 0.6 keeps bloom on the animal's light and the
    // parasites' cores only.
    bloom: { strength: 0.95, threshold: 0.34, radius: 0.6 },
    vignette: { inner: 0.36, outer: 1.12, strength: 0.68 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the animal's landmarks get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: bar(1) + 0.2, text: 'PARASITES ON THE STRANDS', hold: 2.2 },
      { at: BELL_TIME + 3.4, text: 'THE BELL', hold: 2.2 },
      { at: CROWN_TIME - 2.6, text: 'THE CROWN — WHERE THE STRANDS ROOT', hold: 2.4 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let sporeSeen = false;
    let parentKilled = false;
    let deadlineSaid = false;
    let broodKills = 0;
    const broodlingIds = new Set<number>();
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'spore' && !sporeSeen) {
        sporeSeen = true;
        say('SPORES — SHOOT THEM DOWN', 2.4);
      }
      if (kind === 'broodling') broodlingIds.add(enemyId);
      if (kind === 'parent') say('THE PARENT', 2.8);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!broodlingIds.delete(enemyId)) return;
      broodKills += 1;
      if (broodKills % BROOD_SIZE === 0 && broodKills < BROOD_SIZE * 3) say('BROOD DEAD — THE WEB DIES BACK', 2.4);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('BARE — TEAR IT LOOSE', 2.6);
      if (phase === 'destroyed') {
        parentKilled = true;
        say('TORN LOOSE — IT DRIFTS ON', 3.6);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      sporeSeen = false;
      parentKilled = false;
      deadlineSaid = false;
      broodKills = 0;
      broodlingIds.clear();
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
        updateAttractCamera({ camera, modeTime }) {
          updateAttractCamera(camera, modeTime);
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
          if (!parentKilled && !deadlineSaid && runTime >= DEADLINE_TIME) {
            deadlineSaid = true;
            say('IT HOLDS ON', 3.0);
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
