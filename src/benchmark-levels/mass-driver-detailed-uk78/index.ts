import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { disposeObject3D } from '../../engine/visual-kit';
import { createAudio } from './audio';
import { createMassDriverGameplay } from './gameplay';
import {
  INTERLOCK_TIME,
  MASS_DRIVER_BPM,
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_SECTIONS,
  MASS_DRIVER_TIME,
  SHOT_TIME,
  WARNING_TIME,
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
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverDetailedUk78Level: LevelDefinition = {
  id: 'mass-driver-detailed-uk78',
  title: 'Mass Driver',
  description: 'Ride the payload through an orbital railgun: one accelerator ring per beat, six jammed interlocks, and one hard firing deadline.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_SECTIONS,
  post: {
    clearColor: 0x01040b,
    bloom: { strength: 0.78, threshold: 0.24, radius: 0.72 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.64 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    const environment = createEnvironment(scene);
    const gameplay = createMassDriverGameplay(bus);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let previousRunTime = 0;
    let calloutUntil = -1;
    let now = 0;
    let nextTimedCallout = 0;
    const interlockIds = new Set<number>();
    const timedCallouts = [
      { at: WARNING_TIME, text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: MASS_DRIVER_TIME.bar(1.1) },
      { at: MASS_DRIVER_TIME.bar(23.0), text: 'CHARGE 60%', hold: MASS_DRIVER_TIME.bar(0.75) },
      { at: MASS_DRIVER_TIME.bar(25.6), text: 'CHARGE 85%', hold: MASS_DRIVER_TIME.bar(0.72) },
      { at: MASS_DRIVER_TIME.bar(27.05), text: 'CHARGE CRITICAL', hold: MASS_DRIVER_TIME.bar(0.8) },
    ];
    const say = (message: string, hold: number) => {
      hud.setCallout(message);
      calloutUntil = now + hold;
    };

    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') interlockIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      const cleared = gameplay.metrics.interlocksCleared;
      say(cleared === 6 ? 'INTERLOCKS CLEAR — BRACE FOR SHOT' : `INTERLOCKS ${cleared}/6`, cleared === 6 ? 2.8 : 1.2);
    });
    bus.on('runstart', () => {
      runTime = 0;
      previousRunTime = 0;
      nextTimedCallout = 0;
      interlockIds.clear();
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('runend', ({ died }) => {
      if (died) say('CHARGE CONTAINMENT FAILED', 4);
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
        now = elapsed;
        game.update(dt);
        const running = game.state === 'running';
        previousRunTime = runTime;
        if (running) runTime = Math.min(MASS_DRIVER_TIME.bar(32), runTime + dt);
        while (running && nextTimedCallout < timedCallouts.length && runTime >= timedCallouts[nextTimedCallout].at) {
          const callout = timedCallouts[nextTimedCallout];
          say(callout.text, callout.hold);
          nextTimedCallout += 1;
        }
        if (running && previousRunTime < SHOT_TIME && runTime >= SHOT_TIME && gameplay.metrics.interlocksCleared === 6) {
          say('PAYLOAD AWAY', 2.8);
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          running,
          feel,
          metrics: gameplay.metrics,
        });
      },
      dispose() {
        feel.dispose();
        environment.root.removeFromParent();
        disposeObject3D(environment.root);
        game.dispose();
      },
    };
  },
};
