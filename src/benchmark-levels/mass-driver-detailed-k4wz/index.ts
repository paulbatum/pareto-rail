import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { INTERLOCK_COUNT, MASS_DRIVER_BPM, createMassDriverGameplay } from './gameplay';
import { MASS_DRIVER_MARKERS, MASS_DRIVER_RUN_SECTIONS, MASS_DRIVER_TIME, bar } from './timing';
import {
  composeMassDriverOutput,
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

export const massDriverDetailedK4wzLevel: LevelDefinition = {
  id: 'mass-driver-detailed-k4wz',
  title: 'Mass Driver',
  description: 'Ride the payload down an orbital railgun — one accelerator ring per beat, and the firing charge is already building.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x01020a,
    // NB: the shared pipeline feeds `threshold` into the bloom radius slot and
    // `radius` into the luminance threshold slot; values chosen for that
    // mapping. Bloom present but restrained: thin lines and small cores only.
    bloom: { strength: 0.95, threshold: 0.4, radius: 0.5 },
    vignette: { inner: 0.32, outer: 1.08, strength: 0.75 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // HUD narration: timed callouts frame the deadline. Gameplay owns the
    // fight; this watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    let interlocksDown = 0;
    let interlocksSpawned = 0;
    let gunFired = false;
    let payloadAwaySaid = false;
    const interlockIds = new Set<number>();

    // Charge readouts fire only while interlocks still stand.
    const timedCallouts = [
      { at: bar(19), text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: 2.6, requiresJam: false },
      { at: bar(22), text: 'CHARGE 60%', hold: 1.6, requiresJam: true },
      { at: bar(24), text: 'CHARGE 85%', hold: 1.6, requiresJam: true },
      { at: bar(26), text: 'CHARGE CRITICAL', hold: 2.0, requiresJam: true },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0, requiresJam: false }, // sentinel; never fires
    ];
    let nextCallout = 0;

    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind !== 'interlock') return;
      interlockIds.add(enemyId);
      interlocksSpawned += 1;
    });
    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      interlocksDown += 1;
      if (interlocksDown >= INTERLOCK_COUNT) {
        gunFired = true;
        say('INTERLOCKS CLEAR — BRACE FOR SHOT', 2.8);
      } else {
        say(`INTERLOCKS ${interlocksDown}/${INTERLOCK_COUNT}`, 1.4);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlocksDown = 0;
      interlocksSpawned = 0;
      gunFired = false;
      payloadAwaySaid = false;
      interlockIds.clear();
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
        ...createMassDriverGameplay(bus),
        updateCameraEffects({ camera: effectsCamera, runTime: effectsRunTime, dt }) {
          updateMassDriverCameraEffects(dt, {
            camera: effectsCamera,
            runTime: effectsRunTime,
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
          while (nextCallout < timedCallouts.length - 1 && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            const jammed = interlocksSpawned > 0 && interlocksDown < INTERLOCK_COUNT;
            if (!callout.requiresJam || jammed) say(callout.text, callout.hold);
            nextCallout += 1;
          }
          if (!payloadAwaySaid && gunFired && runTime >= bar(28) + 0.6) {
            payloadAwaySaid = true;
            say('PAYLOAD AWAY', 2.6);
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
          running: game.state === 'running',
        });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
