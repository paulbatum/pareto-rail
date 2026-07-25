import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { THERMAL_INK_BPM, createThermalInk4xmhGameplay, inkDensityAt } from './gameplay';
import { THERMAL_INK_MARKERS, THERMAL_INK_RUN_DURATION, THERMAL_INK_RUN_SECTIONS, THERMAL_INK_TIME } from './timing';
import { INK_BLIND_THRESHOLD, resetVision, updateVision } from './vision';
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
import { composeThermalInkOutput } from './visuals/post-fx';

export const thermalInk4xmhLevel: LevelDefinition = {
  id: 'thermal-ink-4xmh',
  title: 'Thermal Ink',
  description: 'One minute in a drowned harbour, wrestling something that turns the lights out.',
  bpm: THERMAL_INK_BPM,
  markers: THERMAL_INK_MARKERS,
  sections: THERMAL_INK_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: THERMAL_INK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x090603,
    bloom: { strength: 0.8, threshold: 0.78, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.12, strength: 0.6 },
    composeOutput: composeThermalInkOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    // Narration. The fight is loud enough without commentary, so callouts cover
    // only what a player cannot work out alone: that the trigger is also the
    // imager, and what the creature has just lost.
    let runTime = 0;
    let running = false;
    let calloutUntil = -1;
    let now = 0;
    let taughtImager = false;
    let armsSevered = 0;
    const armIds = new Set<number>();
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    bus.on('runstart', () => {
      runTime = 0;
      running = true;
      armsSevered = 0;
      armIds.clear();
      taughtImager = false;
      calloutUntil = -1;
      resetVision();
      hud.setCallout('');
    });
    bus.on('runend', () => {
      running = false;
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind !== 'arm') return;
      armIds.add(enemyId);
      if (runTime < 0.4) say('IT IS ALREADY HERE', 2.4);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!armIds.delete(enemyId)) return;
      armsSevered += 1;
      say(armsSevered >= 4 ? 'ALL ARMS SEVERED' : `ARM SEVERED — ${armsSevered}/4`, 1.8);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('CORE EXPOSED — STRIKE THROUGH THE INK', 3.0);
      if (phase === 'destroyed') say('IT LETS GO', 3.4);
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
      level: createThermalInk4xmhGameplay(bus),
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
        if (running) runTime = Math.min(THERMAL_INK_RUN_DURATION, runTime + dt);

        // Vision resolves before the runner steps, so a release inside a
        // thinning cloud is judged against the same ink the player is seeing.
        const sight = updateVision(dt, running ? inkDensityAt(runTime) : 0);
        if (running && !taughtImager) {
          if (sight.everEngaged) {
            taughtImager = true;
            say('INFRARED', 1.4);
          } else if (sight.ink >= INK_BLIND_THRESHOLD && calloutUntil < now) {
            say('INK — HOLD TO RAISE INFRARED', 2.4);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }

        game.update(dt);
        updateVisuals(dt, { scene, camera, feel, elapsed, runProgress: game.runProgress });
        feel.update(dt, { shake: { pitchDegrees: 0.42, yawDegrees: 0.36, rollDegrees: 1.0, frequency: 7.5 } });
      },
      dispose() {
        feel.dispose();
        game.dispose();
        resetVision();
      },
    };
  },
};
