import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  CHARGE_TIME,
  FIRE_TIME,
  INTERLOCK_COUNT,
  INTERLOCK_TIME,
  MASS_DRIVER_BPM,
  createMassDriverGameplay,
} from './gameplay';
import { MD_MARKERS, MD_RUN_SECTIONS, MD_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateMdCameraEffects,
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverEsvzLevel: LevelDefinition = {
  id: 'mass-driver-esvz',
  title: 'Mass Driver',
  description: 'Ride a payload down an orbital railgun — one accelerator ring per beat — and blow the jammed interlocks before the charge peaks.',
  bpm: MASS_DRIVER_BPM,
  markers: MD_MARKERS,
  sections: MD_RUN_SECTIONS.map((section) => ({ name: section.name, time: MD_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x01020a,
    bloom: { strength: 1.15, threshold: 0.5, radius: 0.22 },
    vignette: { inner: 0.34, outer: 1.1, strength: 0.72 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the run's few callouts. Gameplay owns the fight; this only
    // watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.4, text: 'CHARGE CYCLE INITIATED', hold: 2.2 },
      { at: INTERLOCK_TIME - 0.4, text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: 3.0 },
      { at: CHARGE_TIME + 2.2, text: 'CHARGE APPROACHING PEAK', hold: 2.0 },
      { at: FIRE_TIME + 120, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    const gameplay = createMassDriverGameplay(bus);
    let interlockKills = 0;
    let launchAnnounced = false;
    bus.on('kill', () => {
      const down = gameplay.interlocksDown();
      if (down !== interlockKills) {
        interlockKills = down;
        if (down >= INTERLOCK_COUNT) say('INTERLOCKS CLEAR — BRACE', 2.6);
        else if (down > 0) say(`INTERLOCK ${down}/${INTERLOCK_COUNT} DOWN`, 1.4);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlockKills = 0;
      launchAnnounced = false;
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
        ...gameplay,
        updateCameraEffects({ runTime: cameraRunTime, dt }) {
          updateMdCameraEffects(dt, { camera, runTime: cameraRunTime, running: true, feel: cameraFeel });
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
          if (!launchAnnounced && runTime >= FIRE_TIME && gameplay.launchCleared()) {
            launchAnnounced = true;
            say('PAYLOAD AWAY', 2.4);
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
