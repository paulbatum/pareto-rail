import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import {
  CROWN_TIME,
  DEEP_TIME,
  OPEN_WATER_TIME,
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
  disposeEnvironment,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateAttractCamera,
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineOs2bLevel: LevelDefinition = {
  id: 'strandline-os2b',
  title: 'Strandline',
  description: 'Free a jellyfish the size of a cathedral from the parasites in its trailing strands.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x03101c,
    // NB: the shared post pipeline feeds `threshold` into the bloom radius slot
    // and `radius` into the luminance threshold slot. The water sits well under
    // 0.4 luminance, so the effective threshold keeps bloom on the animal's
    // own light and off the fog.
    bloom: { strength: 0.72, threshold: 0.4, radius: 0.55 },
    vignette: { inner: 0.3, outer: 1.08, strength: 0.7 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    // Narration. Gameplay owns the fight; this only watches the clock and the
    // bus, and names the two things a first-time player needs told.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const timedCallouts = [
      { at: OPEN_WATER_TIME + 0.4, text: 'THE WHOLE ANIMAL', hold: 2.4 },
      { at: DEEP_TIME + 0.2, text: 'BACK INTO THE STRANDS', hold: 2.0 },
      { at: CROWN_TIME - 0.6, text: 'THE CROWN', hold: 2.2 },
    ];
    let nextCallout = 0;
    let toldAboutWebbing = false;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('WEBBING DEAD — TEAR IT LOOSE', 2.8);
      if (phase === 'destroyed') say('THE STRANDS ARE CLEAN', 4.0);
    });
    bus.on('shielded', () => {
      if (toldAboutWebbing) return;
      toldAboutWebbing = true;
      say('WEBBING HOLDS — KILL THE BROOD', 2.8);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      toldAboutWebbing = false;
      calloutUntil = -1;
      hud.setCallout('');
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
      startTip,
      level: {
        ...gameplay,
        updateAttractCamera({ camera: attractCamera, curve, modeTime }) {
          updateAttractCamera(attractCamera, curve, modeTime);
        },
        updateCameraEffects({ camera: runCamera, runTime: elapsedRunTime, dt }) {
          updateStrandlineCameraEffects(dt, { camera: runCamera, runTime: elapsedRunTime, feel });
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
          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
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
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running', feel });
      },
      dispose() {
        feel.dispose();
        game.dispose();
        disposeEnvironment();
      },
    };
  },
};
