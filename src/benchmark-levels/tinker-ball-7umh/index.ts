import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  createTinkerGameplay,
  createTinkerRail,
  speedProfile,
} from './gameplay';
import {
  bar,
  TINKER_BARS,
  TINKER_BPM,
  TINKER_MARKERS,
  TINKER_RUN_DURATION,
  TINKER_RUN_SECTIONS,
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
  updateVisuals,
} from './visuals';
import { composeTinkerOutput } from './visuals/post-fx';

export const tinkerBallLevel: LevelDefinition = {
  id: 'tinker-ball-7umh',
  title: 'Tinker Ball',
  description: 'Roll across an oversized cluttered worktable, dismantling dark glue monsters and rescuing clean craft supplies.',
  bpm: TINKER_BPM,
  markers: TINKER_MARKERS,
  sections: TINKER_RUN_SECTIONS.map((s) => ({
    name: s.name,
    time: bar(s.fromBar),
  })),
  post: {
    clearColor: 0x180f0a,
    bloom: { strength: 0.95, threshold: 0.58, radius: 0.2 },
    vignette: { inner: 0.32, outer: 1.12, strength: 0.75 },
    composeOutput: composeTinkerOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const curve = createTinkerRail();
    const feel = createCameraFeel(camera);
    createEnvironment(scene, curve);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let running = false;
    let calloutUntil = -1;
    let nextCalloutIndex = 0;

    const say = (message: string, duration: number) => {
      hud.setCallout(message);
      calloutUntil = runTime + duration;
    };

    const timedCallouts = [
      { at: bar(TINKER_BARS.marbleGroove), text: 'MARBLE SCALE — CLUTTER PATROL', hold: 2.5 },
      { at: bar(TINKER_BARS.scaleTennis), text: 'TENNIS-BALL SCALE — WORKSHOP RUSH', hold: 2.8 },
      { at: bar(TINKER_BARS.scaleMelon), text: 'MELON SCALE — GLUE SPILL IN SIGHT', hold: 2.8 },
      { at: bar(TINKER_BARS.spillBoss), text: 'THE GREAT GLUE SPILL — CRACK THE CORES', hold: 3.2 },
      { at: bar(TINKER_BARS.spillHeart) - 0.2, text: 'GRAND HEART EXPOSED — BREAK IT!', hold: 3.0 },
      { at: bar(TINKER_BARS.finale), text: 'TABLE CLEANED — SPOTLESS FINISH!', hold: 3.5 },
    ];

    bus.on('runstart', () => {
      runTime = 0;
      running = true;
      calloutUntil = -1;
      nextCalloutIndex = 0;
      hud.setCallout('');
    });

    bus.on('runend', () => {
      running = false;
    });

    const gameplay = createTinkerGameplay(bus);

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
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
        game.update(dt);

        if (running && game.state === 'running') {
          runTime = Math.min(TINKER_RUN_DURATION, runTime + dt);

          if (nextCalloutIndex < timedCallouts.length) {
            const nextCallout = timedCallouts[nextCalloutIndex];
            if (runTime >= nextCallout.at) {
              say(nextCallout.text, nextCallout.hold);
              nextCalloutIndex += 1;
            }
          }

          if (calloutUntil > 0 && runTime >= calloutUntil) {
            hud.setCallout('');
            calloutUntil = -1;
          }
        }

        const isRunning = running && game.state === 'running';
        const progress = isRunning ? speedProfile.runProgress(runTime) : 0;
        const currentSpeed = isRunning ? speedProfile.speedAt(runTime) : 1;

        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          dt,
          runProgress: progress,
          speed: currentSpeed,
          running: isRunning,
        });
      },
      dispose() {
        game.dispose();
        disposeEnvironment();
      },
    };
  },
};
