import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createBroadsideGameplay } from './gameplay';
import {
  bar,
  BROADSIDE_BARS,
  BROADSIDE_BPM,
  BROADSIDE_DURATION,
  BROADSIDE_MARKERS,
  BROADSIDE_RUN_SECTIONS,
  BROADSIDE_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const broadsideFkioLevel: LevelDefinition = {
  id: 'broadside-fkio',
  title: 'Broadside',
  description: 'Launch off the flagship deck into a full fleet engagement, raking warships and destroying the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map(({ name, fromBar }) => ({
    name,
    time: BROADSIDE_TIME.bar(fromBar),
  })),
  post: {
    clearColor: 0x030107,
    bloom: { strength: 0.55, threshold: 0.82, radius: 0.1 },
    vignette: { inner: 0.42, outer: 1.15, strength: 0.45 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;

    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + seconds;
    };

    const scriptedCalls = [
      { at: bar(3.5), text: 'LAUNCH COMMITTED — ENTERING FLEET MELEE', hold: 2.5 },
      { at: bar(4.8), text: 'VALIANT FIRING BROADSIDES — FLY HER FLANK', hold: 2.8 },
      { at: bar(10.2), text: 'EYE OF THE BATTLE — RAKE DREADNOUGHT BELLY', hold: 3.0 },
      { at: bar(16.2), text: 'ENEMY FLAGSHIP DETECTED — DESTROY SHIELD GENERATORS', hold: 3.2 },
      { at: bar(22.2), text: 'SHIELDS COLLAPSED — ESCORTS INCOMING', hold: 2.6 },
      { at: bar(25.0), text: 'COMMENCING TRENCH DIVE — TARGET CORE REACTORS', hold: 2.8 },
      { at: bar(28.0), text: 'CORE CRITICAL — BREAK AWAY! VICTORY!', hold: 3.5 },
    ];
    let nextCallIdx = 0;

    bus.on('runstart', () => {
      runTime = 0;
      nextCallIdx = 0;
      calloutUntil = -1;
      feel.kickFov(8, { decay: 3.0 });
      feel.shake(0.3);
      hud.setCallout('CATAPULT ENGAGED — LOCK TO LAUNCH');
      calloutUntil = elapsedNow + 2.5;
    });

    bus.on('playerhit', ({ healthRemaining }) => {
      feel.shake(0.45);
      feel.kickFov(-4, { decay: 4.5 });
      say(`HULL IMPACT — INTEGRITY ${healthRemaining}`, 1.8);
    });

    bus.on('stage', () => {
      feel.shake(0.4);
      feel.kickFov(4, { decay: 3.0 });
    });

    bus.on('beat', ({ beatNumber }) => {
      // Small camera punch on heavy downbeats during cruiser broadsides
      if (runTime > bar(4) && runTime < bar(10) && beatNumber % 4 === 0) {
        feel.shake(0.12);
      }
    });

    const gameplay = createBroadsideGameplay(bus);

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
        updateCameraEffects({ runTime: time, dt }) {
          runTime = time;

          // Callout timeline progression
          if (nextCallIdx < scriptedCalls.length && time >= scriptedCalls[nextCallIdx].at) {
            const call = scriptedCalls[nextCallIdx];
            say(call.text, call.hold);
            nextCallIdx += 1;
          }

          // Dynamic FOV & feel based on flight envelope
          if (time > bar(3.5) && time < bar(5.0)) {
            // Catapult launch surge
            feel.setFovOffset(5.0);
          } else if (time > bar(25.0) && time < bar(28.0)) {
            // Trench dive speed tunnel
            feel.setFovOffset(6.5);
            feel.shake(dt * 0.25);
          } else if (time >= bar(28.0)) {
            // Wide victory pullout
            feel.setFovOffset(-8.0);
          } else {
            feel.setFovOffset(0);
          }

          feel.update(dt);
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
        elapsedNow = elapsed;
        if (calloutUntil > 0 && elapsedNow >= calloutUntil) {
          hud.setCallout('');
          calloutUntil = -1;
        }
        updateVisuals(camera, runTime, dt);
        game.update(dt);
      },
      dispose() {
        game.dispose();
        feel.dispose();
        disposeVisuals();
      },
    };
  },
};
