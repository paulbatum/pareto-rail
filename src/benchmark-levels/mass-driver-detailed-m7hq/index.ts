import type { LevelDefinition } from '../../engine/types';
import { MathUtils } from 'three';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT,
  MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U,
  createMassDriverDetailedM7hqGameplay,
  massDriverDetailedM7hqSpeedAt,
} from './gameplay';
import {
  MASS_DRIVER_DETAILED_M7HQ_BPM,
  MASS_DRIVER_DETAILED_M7HQ_MARKERS,
  MASS_DRIVER_DETAILED_M7HQ_RUN_SECTIONS,
  MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME,
  MASS_DRIVER_DETAILED_M7HQ_TIME,
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
  updateEnemyVisuals,
} from './visuals';

export const massDriverDetailedM7hqLevel: LevelDefinition = {
  id: 'mass-driver-detailed-m7hq',
  title: 'Mass Driver',
  description: 'Ride the payload through one accelerator ring per beat, clear six jammed interlocks, and survive the orbital railgun firing at bar 28.',
  bpm: MASS_DRIVER_DETAILED_M7HQ_BPM,
  markers: MASS_DRIVER_DETAILED_M7HQ_MARKERS,
  sections: MASS_DRIVER_DETAILED_M7HQ_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_DETAILED_M7HQ_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x01030b,
    bloom: { strength: 1.08, threshold: 0.6, radius: 0.18 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.74 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const environment = createEnvironment(scene);
    const feel = createCameraFeel(camera);
    const effects = installVisualEventHandlers(bus, scene, feel, environment);
    const gameplay = createMassDriverDetailedM7hqGameplay(bus);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextTimedCallout = 0;
    let lastInterlocks = 0;
    let shotTriggered = false;
    let cameraShotTriggered = false;
    const timedCallouts = [
      { at: 0.35, text: 'PAYLOAD CHAMBERED', hold: 1.8, conditional: false },
      { at: MASS_DRIVER_DETAILED_M7HQ_MARKERS.warning, text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: 3.0, conditional: false },
      { at: MASS_DRIVER_DETAILED_M7HQ_MARKERS.charge60, text: 'CHARGE 60%', hold: 1.6, conditional: true },
      { at: MASS_DRIVER_DETAILED_M7HQ_MARKERS.charge85, text: 'CHARGE 85%', hold: 1.5, conditional: true },
      { at: MASS_DRIVER_DETAILED_M7HQ_MARKERS.critical, text: 'CHARGE CRITICAL', hold: 1.8, conditional: true },
    ];
    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + hold;
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextTimedCallout = 0;
      lastInterlocks = 0;
      shotTriggered = false;
      cameraShotTriggered = false;
      calloutUntil = -1;
      hud.setCallout('');
      environment.reset();
      feel.restore();
    });
    bus.on('beat', ({ isDownbeat }) => {
      if (isDownbeat) {
        feel.shake(runTime >= MASS_DRIVER_DETAILED_M7HQ_MARKERS.interlock ? 0.12 : 0.045, { maxTrauma: 0.62, decay: 5.4 });
        if (runTime > 0 && runTime < MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME) feel.kickFov(0.34, { decay: 10 });
      }
    });
    bus.on('kill', () => {
      const cleared = gameplay.interlocksCleared();
      if (cleared === lastInterlocks) return;
      lastInterlocks = cleared;
      if (cleared >= MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT) {
        say('INTERLOCKS CLEAR — BRACE FOR SHOT', 3.2);
        environment.tunnelStrobe();
        feel.kickFov(5.2, { decay: 2.2 });
      } else {
        say(`INTERLOCKS ${cleared}/${MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT}`, 1.25);
      }
    });
    bus.on('playerhit', () => feel.shake(0.36, { maxTrauma: 0.9, decay: 1.8 }));
    bus.on('runend', ({ died }) => {
      if (died && gameplay.detonated()) {
        shotTriggered = true;
        environment.shotFlash(false);
        say('CHARGE CONTAINMENT FAILED', 5);
        feel.kickFov(12, { decay: 0.55 });
        feel.shake(1, { maxTrauma: 1, decay: 0.25 });
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
        updateCameraEffects({ runTime: time, runProgress, dt, curve }) {
          const charge = Math.max(0, (time - MASS_DRIVER_DETAILED_M7HQ_MARKERS.interlock)
            / (MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME - MASS_DRIVER_DETAILED_M7HQ_MARKERS.interlock));
          const speed = massDriverDetailedM7hqSpeedAt(time);
          if (runProgress < MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U) {
            const u = MathUtils.clamp(runProgress, 0, MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U);
            const aheadU = Math.min(MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U, u + 0.004);
            const tangent = curve.getTangentAt(u);
            const ahead = curve.getTangentAt(aheadU);
            const muzzleFade = MathUtils.smoothstep(MASS_DRIVER_DETAILED_M7HQ_MUZZLE_U - u, 0, 0.045);
            const weaveBank = MathUtils.clamp((ahead.x - tangent.x) * -8.5, -0.027, 0.027) * muzzleFade;
            camera.rotateZ(weaveBank);
          }
          feel.setFovOffset(runProgress * 4.4 + speed * 1.15 + charge * 2.4, { response: 4.8 });
          if (!cameraShotTriggered && time >= MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME) {
            cameraShotTriggered = true;
            feel.kickFov(15, { decay: 0.8 });
            feel.shake(0.82, { maxTrauma: 1, decay: 0.55 });
          }
          feel.update(dt, {
            shake: {
              pitchDegrees: 0.32 + charge * 0.35,
              yawDegrees: 0.24 + charge * 0.28,
              rollDegrees: 0.95 + charge * 1.8,
              frequency: 11 + charge * 13,
              smoothing: 25,
            },
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
        elapsedNow = elapsed;
        const wasRunning = game.state === 'running';
        if (wasRunning) {
          runTime += dt;
          while (nextTimedCallout < timedCallouts.length && runTime >= timedCallouts[nextTimedCallout].at) {
            const callout = timedCallouts[nextTimedCallout];
            if (!callout.conditional || gameplay.interlocksCleared() < MASS_DRIVER_DETAILED_M7HQ_INTERLOCK_COUNT) {
              say(callout.text, callout.hold);
            }
            nextTimedCallout += 1;
          }
        }
        game.update(dt);
        if (!shotTriggered && runTime >= MASS_DRIVER_DETAILED_M7HQ_SHOT_TIME) {
          shotTriggered = true;
          const success = gameplay.resolveShot();
          environment.shotFlash(success);
          if (success) say('PAYLOAD AWAY', 2.6);
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        updateEnemyVisuals(dt, runTime, camera);
        effects.update(dt, camera);
        environment.update(dt, runTime, game.state === 'running', camera, gameplay.gunFired(), gameplay.detonated());
      },
      dispose() {
        game.dispose();
        effects.dispose();
        environment.dispose();
        disposeVisuals();
        feel.dispose();
      },
    };
  },
};
