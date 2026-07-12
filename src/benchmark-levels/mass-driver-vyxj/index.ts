import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay, INTERLOCK_COUNT, MASS_DRIVER_BPM } from './gameplay';
import {
  ALARM_TIME,
  BOSS_TIME,
  FIRE_TIME,
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_RUN_SECTIONS,
  MASS_DRIVER_TIME,
  STAGE2_TIME,
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
  updateCameraEffects as updateMassDriverCameraEffects,
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverVyxjLevel: LevelDefinition = {
  id: 'mass-driver-vyxj',
  title: 'Mass Driver',
  description: 'Ride a payload down an orbital railgun — one accelerator ring on every beat — and clear the jammed interlocks before the firing charge peaks.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x030409,
    bloom: { strength: 1.1, threshold: 0.55, radius: 0.22 },
    vignette: { inner: 0.34, outer: 1.1, strength: 0.72 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the launch gets a voice. Gameplay owns the fight; this only
    // watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: STAGE2_TIME - 0.1, text: 'SECOND STAGE', hold: 1.8 },
      { at: ALARM_TIME + 0.1, text: 'SAFETY INTERLOCKS JAMMED', hold: 2.6 },
      { at: BOSS_TIME + 0.1, text: 'FIRING CHARGE BUILDING — CLEAR ALL SIX', hold: 3.0 },
      { at: FIRE_TIME - 3.9, text: 'CHARGE CRITICAL', hold: 1.8 },
      { at: FIRE_TIME + 0.5, text: 'PAYLOAD AWAY', hold: 2.4 },
      { at: FIRE_TIME + 120, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;
    let interlocksDown = 0;
    let cleared = false;

    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') {
        cleared = true;
        say('INTERLOCKS CLEAR — BRACE FOR FIRING', 3.2);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlocksDown = 0;
      cleared = false;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const gameplay = createMassDriverGameplay(bus);

    // Interlock kill counter for the callout feed.
    const interlockIds = new Set<number>();
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') interlockIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      interlocksDown += 1;
      if (!cleared && interlocksDown < INTERLOCK_COUNT) {
        say(`INTERLOCK ${interlocksDown}/${INTERLOCK_COUNT} CLEAR`, 1.4);
      }
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
        updateCameraEffects({ runTime: cameraRunTime, dt }) {
          updateMassDriverCameraEffects(dt, { camera, runTime: cameraRunTime, running: true, feel: cameraFeel });
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
            // Don't stomp the clear message with the critical warning.
            if (!(cleared && callout.text === 'CHARGE CRITICAL')) say(callout.text, callout.hold);
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
