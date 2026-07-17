import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay, INTERLOCK_COUNT } from './gameplay';
import { bar, INTERLOCK_TIME, MASS_DRIVER_BPM, MD_MARKERS, MD_RUN_SECTIONS, MD_TIME, SHOT_TIME } from './timing';
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

export const massDriverDetailed4m9vLevel: LevelDefinition = {
  id: 'mass-driver-detailed-4m9v',
  title: 'Mass Driver',
  description: 'Ride the payload down an orbital railgun — one accelerator ring per beat, and the firing charge is already building.',
  bpm: MASS_DRIVER_BPM,
  markers: MD_MARKERS,
  sections: MD_RUN_SECTIONS.map((section) => ({ name: section.name, time: MD_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x01020a,
    bloom: { strength: 1.0, threshold: 0.58, radius: 0.22 },
    vignette: { inner: 0.34, outer: 1.12, strength: 0.72 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    const gameplay = createMassDriverGameplay(bus);

    // Narration: the deadline gets a voice. Gameplay owns the fight; this
    // only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    // Charge readouts fire only while interlocks still stand.
    const timedCallouts: Array<{ at: number; text: string; hold: number; onlyWhileJammed?: boolean; onlyIfFired?: boolean }> = [
      { at: INTERLOCK_TIME - MD_TIME.barSeconds, text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: 2.6 },
      { at: bar(22), text: 'CHARGE 60%', hold: 1.6, onlyWhileJammed: true },
      { at: bar(24), text: 'CHARGE 85%', hold: 1.6, onlyWhileJammed: true },
      { at: bar(26), text: 'CHARGE CRITICAL', hold: 2.2, onlyWhileJammed: true },
      { at: SHOT_TIME + 0.7, text: 'PAYLOAD AWAY', hold: 2.6, onlyIfFired: true },
    ];
    let nextCallout = 0;

    const interlockIds = new Set<number>();
    let interlockKills = 0;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') interlockIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      interlockKills += 1;
      if (interlockKills >= INTERLOCK_COUNT) say('INTERLOCKS CLEAR — BRACE FOR SHOT', 2.8);
      else say(`INTERLOCKS ${interlockKills}/${INTERLOCK_COUNT}`, 1.5);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlockIds.clear();
      interlockKills = 0;
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
        updateCameraEffects({ camera, runTime, dt }) {
          updateMassDriverCameraEffects(dt, { camera, runTime, running: true, feel: cameraFeel });
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
            if (callout.onlyWhileJammed && interlockKills >= INTERLOCK_COUNT) continue;
            if (callout.onlyIfFired && !gameplay.gunFired()) continue;
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
