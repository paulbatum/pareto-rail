import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhookGameplay } from './gameplay';
import { skyhookSignals } from './signals';
import { bar, DECK_TIME, SKYHOOK_BPM, SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME, THIN_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateSkyhookCameraEffects,
  updateVisuals,
} from './visuals';
import { composeSkyhookOutput } from './visuals/post-fx';

export const skyhook2j6oLevel: LevelDefinition = {
  id: 'skyhook-2j6o',
  title: 'Skyhook',
  description: 'Ride a climber up the space elevator, from the weather to the black, and keep it in one piece.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({ name: section.name, time: SKYHOOK_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x30343a,
    bloom: { strength: 0.85, threshold: 0.74, radius: 0.16 },
    vignette: { inner: 0.36, outer: 1.08, strength: 0.55 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the climb's stations get names. Gameplay owns the fight;
    // this only watches the clock, the bus and the level's own signals.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: DECK_TIME - 1.6, text: 'CLOUD DECK', hold: 2.0 },
      { at: THIN_TIME, text: 'THE AIR THINS', hold: 2.2 },
      { at: bar(28), text: 'DOCKING', hold: 2.4, stationOpen: true },
      { at: bar(31, 2), text: 'DOCKED', hold: 4.0, docked: true },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;
    let stationOpened = false;

    const offSignals = [
      skyhookSignals.on('bossLatch', () => say('CONTACT ON THE TETHER', 2.6)),
      skyhookSignals.on('bossEngage', () => say('IN RANGE — TAKE THE CLAWS', 2.6)),
      skyhookSignals.on('bossGrip', () => say('CORE EXPOSED', 2.2)),
      skyhookSignals.on('bossReach', () => say('IT HAS THE DECK', 2.6)),
      skyhookSignals.on('bossDead', () => {
        stationOpened = true;
        say('TETHER CLEAR — STATION OPENING', 3.2);
      }),
      skyhookSignals.on('clamp', () => say('LIMPET ON THE HULL', 1.8)),
    ];
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      stationOpened = false;
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
        ...createSkyhookGameplay(bus),
        updateCameraEffects({ camera: activeCamera, runTime: activeRunTime, dt }) {
          updateSkyhookCameraEffects(dt, { camera: activeCamera, runTime: activeRunTime, running: true, feel: cameraFeel });
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
            if (callout.stationOpen && !stationOpened) {
              stationOpened = true;
              skyhookSignals.emit('stationOpen', {});
            }
            if (callout.docked) skyhookSignals.emit('docked', {});
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        if (!running) updateSkyhookCameraEffects(dt, { camera, runTime: 0, running: false, feel: cameraFeel });
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running', feel: cameraFeel });
      },
      dispose() {
        for (const off of offSignals) off();
        skyhookSignals.clear();
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
