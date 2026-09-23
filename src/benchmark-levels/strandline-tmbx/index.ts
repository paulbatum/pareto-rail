import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { crownChannel } from './crown';
import { createStrandlineGameplay } from './gameplay';
import { STRANDLINE_BPM, STRANDLINE_DURATION, STRANDLINE_MARKERS, STRANDLINE_RUN_SECTIONS, STRANDLINE_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraFeel,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineTmbxLevel: LevelDefinition = {
  id: 'strandline-tmbx',
  title: 'Strandline',
  description: 'Thread the glowing strands of a giant jellyfish and tear the parasite colony off its crown.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({ name: section.name, time: STRANDLINE_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x04161d,
    // The shared pipeline feeds `threshold` into bloom's radius slot and
    // `radius` into its luminance threshold: sunlit water peaks near 0.7, so
    // an effective threshold of 0.78 leaves bloom to the HDR bioluminescence.
    bloom: { strength: 0.95, threshold: 0.32, radius: 0.78 },
    vignette: { inner: 0.36, outer: 1.12, strength: 0.7 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);
    const gameplay = createStrandlineGameplay(bus, debugValue);

    // Narration: only the fight gets words. The forest and the bell speak
    // for themselves.
    let runTime = 0;
    let endedFor = 0;
    let now = 0;
    let calloutUntil = -1;
    let broodsSeen = 0;
    let witherSeen = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('runstart', () => {
      runTime = 0;
      endedFor = 0;
      broodsSeen = 0;
      witherSeen = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('BARE — TEAR IT LOOSE', 2.4);
      if (phase === 'destroyed') say('SHE IS FREE', 4);
    });
    crownChannel(bus).on((signal) => {
      if (signal.type === 'arrive') say('THE PARENT — DUG INTO THE CROWN', 2.6);
      if (signal.type === 'pump' && broodsSeen === 0) say('A BROOD — CLEAR IT ALL TO KILL ITS WEB', 2.8);
      if (signal.type === 'pump') broodsSeen += 1;
      if (signal.type === 'pump' && signal.repump) say('IT SLIPPED BACK — THE WEB FEEDS AGAIN', 2.2);
      if (signal.type === 'wither') {
        witherSeen += 1;
        if (witherSeen === 1) say('THE WEB DIES BACK', 1.8);
      }
      if (signal.type === 'burrow') say('THE COLONY HOLDS THE CROWN', 3.4);
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
        ...gameplay,
        updateCameraEffects(context) {
          gameplay.updateCameraEffects?.(context);
          updateCameraFeel(context.dt, context.camera, context.runTime, gameplay.finaleElapsed(context.runTime), feel);
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
        if (game.state === 'running') runTime = Math.min(STRANDLINE_DURATION, runTime + dt);
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        let finaleElapsed = -1;
        if (game.state === 'running') {
          finaleElapsed = gameplay.finaleElapsed(runTime);
        } else if (game.state === 'ended') {
          // The animal drifts on behind the run summary.
          endedFor += dt;
          if (gameplay.holdFinaleCamera(camera, endedFor)) {
            camera.updateMatrixWorld();
            finaleElapsed = gameplay.finaleElapsed(STRANDLINE_DURATION + endedFor);
          }
          feel.update(dt);
        }
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          running: game.state === 'running',
          finaleElapsed,
          outcome: gameplay.outcome(),
        });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
