import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay, INTERLOCK_COUNT, MASS_DRIVER_BPM } from './gameplay';
import { BAR_SECONDS, INTERLOCK_TIME, MARKERS, MUSIC, RUN_SECTIONS, SHOT_TIME } from './timing';
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

export const massDriverDetailedM3rpLevel: LevelDefinition = {
  id: 'mass-driver-detailed-m3rp',
  title: 'Mass Driver',
  description: 'Ride the payload down an orbital railgun — one accelerator ring per beat, and the firing charge is already building.',
  bpm: MASS_DRIVER_BPM,
  markers: MARKERS,
  sections: RUN_SECTIONS.map((section) => ({ name: section.name, time: MUSIC.bar(section.fromBar) })),
  post: {
    clearColor: 0x020307,
    bloom: { strength: 1.1, threshold: 0.55, radius: 0.2 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.72 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // HUD narration: gameplay owns the fight; this only watches the clock and
    // the bus, and frames the deadline.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    const interlockIds = new Set<number>();
    let interlocksDown = 0;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') interlockIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      interlocksDown += 1;
      if (interlocksDown < INTERLOCK_COUNT) say(`INTERLOCKS ${interlocksDown}/${INTERLOCK_COUNT}`, 1.1);
      else say('INTERLOCKS CLEAR — BRACE FOR SHOT', 2.6);
    });

    // The charge readout only nags while interlocks still stand; once the gun
    // is committed, the music and the tunnel carry the tension instead.
    const timedCallouts = [
      { at: INTERLOCK_TIME - BAR_SECONDS, text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: 2.4, always: true, requiresClear: false },
      { at: MUSIC.bar(24), text: 'CHARGE 60%', hold: 1.3, always: false, requiresClear: false },
      { at: MUSIC.bar(26), text: 'CHARGE 85%', hold: 1.3, always: false, requiresClear: false },
      { at: MUSIC.bar(27), text: 'CHARGE CRITICAL', hold: 1.6, always: false, requiresClear: false },
      { at: SHOT_TIME + 0.2, text: 'PAYLOAD AWAY', hold: 3.2, always: false, requiresClear: true },
    ];
    let nextCallout = 0;

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      interlockIds.clear();
      interlocksDown = 0;
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
        updateCameraEffects({ runTime: engineRunTime, dt }) {
          updateMassDriverCameraEffects(dt, { camera, runTime: engineRunTime, running: true, feel: cameraFeel });
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
            const cleared = interlocksDown >= INTERLOCK_COUNT;
            if (callout.requiresClear && !cleared) continue;
            if (!callout.always && !callout.requiresClear && cleared) continue;
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
