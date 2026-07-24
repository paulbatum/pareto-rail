import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay, INTERLOCK_COUNT, LAUNCH_TIME, MUZZLE_TIME } from './gameplay';
import { bar, MASS_DRIVER_BPM, MASS_DRIVER_MARKERS, MASS_DRIVER_RUN_SECTIONS, MASS_DRIVER_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateMassDriverCameraEffects,
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverD8qzLevel: LevelDefinition = {
  id: 'mass-driver-d8qz',
  title: 'Mass Driver',
  description: 'Ride a payload down an orbital railgun. One ring, every beat.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x010104,
    bloom: { strength: 0.95, threshold: 0.68, radius: 0.22 },
    vignette: { inner: 0.3, outer: 1.05, strength: 0.82 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the barrel talks to the payload. Gameplay owns the fight; this
    // only watches the clock, the interlock count, and the bus.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const liveInterlocks = new Set<number>();
    let cleared = false;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    // `when` guards the conditional charge readout: it only shouts at you while
    // there is still a clamp to blow.
    const timedCallouts: Array<{ at: number; text: string; hold: number; when?: () => boolean }> = [
      { at: bar(2), text: 'RIDE THE RINGS', hold: 2.2 },
      { at: bar(8), text: 'ACCELERATING', hold: 1.6 },
      { at: bar(14), text: 'ARC PHASE', hold: 1.6 },
      { at: bar(19, 2), text: 'SAFETY INTERLOCK FAULT', hold: 2.4 },
      { at: bar(24), text: 'FIRING CHARGE 60%', hold: 1.5, when: () => liveInterlocks.size > 0 },
      { at: bar(26), text: 'FIRING CHARGE 80%', hold: 1.5, when: () => liveInterlocks.size > 0 },
      { at: bar(27), text: 'CHARGE 95% — BLOW THE CLAMPS', hold: 1.6, when: () => liveInterlocks.size > 0 },
      { at: LAUNCH_TIME, text: '', hold: 0 },
      { at: MUZZLE_TIME, text: 'MUZZLE', hold: 2.6, when: () => cleared },
    ];
    let nextCallout = 0;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say(`${INTERLOCK_COUNT} INTERLOCKS JAMMED`, 2.6);
      else if (phase === 'exposed') say('HALF CLEAR — KEEP GOING', 2.0);
      else {
        cleared = true;
        say('INTERLOCKS CLEAR — BRACE', 2.8);
      }
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') liveInterlocks.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => liveInterlocks.delete(enemyId));
    bus.on('miss', ({ enemyId }) => liveInterlocks.delete(enemyId));
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      liveInterlocks.clear();
      cleared = false;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const massDriverGameplay = createMassDriverGameplay(bus);
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
        ...massDriverGameplay,
        updateCameraEffects(context) {
          // Gameplay owns the rifling roll; the visuals own the lens and the shake.
          massDriverGameplay.updateCameraEffects?.(context);
          updateMassDriverCameraEffects(context.dt, {
            camera: context.camera,
            runTime: context.runTime,
            running: true,
            feel: cameraFeel,
          });
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
            nextCallout += 1;
            if (callout.text.length === 0) {
              // The charge peak speaks for itself.
              say(cleared ? 'FIRE' : 'BARREL OVERLOAD', cleared ? 2.4 : 3.0);
              continue;
            }
            if (callout.when && !callout.when()) continue;
            say(callout.text, callout.hold);
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
