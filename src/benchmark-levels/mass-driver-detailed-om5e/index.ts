import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  INTERLOCK_COUNT,
  MASS_DRIVER_BPM,
  createMassDriverGameplay,
  massDriverRunProgress,
} from './gameplay';
import {
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_RUN_SECTIONS,
  MASS_DRIVER_TIME,
  SHOT_TIME,
  bar,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  fireDetonation,
  fireInterlocksClearStrobe,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverDetailedOm5eLevel: LevelDefinition = {
  id: 'mass-driver-detailed-om5e',
  title: 'Mass Driver',
  description: 'Ride the payload down an orbital railgun — one accelerator ring per beat, and the firing charge is already building.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x01030a,
    // Bloom stays restrained under a soft vignette: the glow belongs on thin
    // lines and small cores, and the level must read with the slider at zero.
    bloom: { strength: 0.95, threshold: 0.62, radius: 0.18 },
    vignette: { inner: 0.34, outer: 1.06, strength: 0.74 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration frames the deadline. Gameplay owns the fight; this only watches
    // the run clock and the bus.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    let interlocksDown = 0;
    let payloadAway = false;
    const interlockIds = new Set<number>();

    const say = (message: string, hold: number) => {
      hud.setCallout(message);
      calloutUntil = now + hold;
    };

    const timedCallouts: Array<{ at: number; text: string; hold: number }> = [
      { at: bar(19), text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: 2.4 },
      { at: bar(22), text: 'CHARGE 60%', hold: 1.6 },
      { at: bar(25), text: 'CHARGE 85%', hold: 1.6 },
      { at: bar(26, 2), text: 'CHARGE CRITICAL', hold: 2.0 },
    ];

    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') interlockIds.add(enemyId);
    });

    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      interlocksDown += 1;
      if (interlocksDown < INTERLOCK_COUNT) {
        say(`INTERLOCKS ${interlocksDown}/${INTERLOCK_COUNT}`, 1.3);
        return;
      }
      say('INTERLOCKS CLEAR — BRACE FOR SHOT', 2.4);
      fireInterlocksClearStrobe();
    });

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlocksDown = 0;
      payloadAway = false;
      interlockIds.clear();
      calloutUntil = -1;
      hud.setCallout('');
    });

    bus.on('runend', ({ died }) => {
      if (died) fireDetonation(camera);
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
      level: createMassDriverGameplay(bus),
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
          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            nextCallout += 1;
            // A charge readout is pointless once the array is already clear.
            if (callout.text.startsWith('CHARGE') && interlocksDown >= INTERLOCK_COUNT) continue;
            say(callout.text, callout.hold);
          }
          if (!payloadAway && interlocksDown >= INTERLOCK_COUNT && runTime >= SHOT_TIME) {
            payloadAway = true;
            say('PAYLOAD AWAY', 3.0);
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
          feel: cameraFeel,
          elapsed,
          runTime,
          // Derived from the run clock rather than read off the runner: the runner
          // reports 1 once the run ends, which would snap a detonation's frame to
          // open-space vacuum instead of leaving it in the barrel.
          runProgress: massDriverRunProgress(runTime),
          running: game.state === 'running',
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
