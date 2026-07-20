import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay } from './gameplay';
import { MASS_DRIVER_BARS, MASS_DRIVER_BPM, MASS_DRIVER_MARKERS, MASS_DRIVER_SECTIONS, MASS_DRIVER_SHOT_TIME, MASS_DRIVER_TIME } from './timing';
import {
  createEnemyMesh, createEnvironment, createProjectileMesh, createReticle, disposeVisuals,
  installVisualEventHandlers, setEnemyDenied, setEnemyLocked, setReticleActive,
  triggerShot, updateCameraEffects, updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverDetailedP8jnLevel: LevelDefinition = {
  id: 'mass-driver-detailed-p8jn',
  title: 'Mass Driver',
  description: 'Ride the firing charge through a beat-locked orbital railgun and clear its six jammed interlocks before the shot.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_SECTIONS.map((section) => ({ name: section.name, time: MASS_DRIVER_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x01030a,
    bloom: { strength: 0.7, threshold: 0.22, radius: 0.74 },
    vignette: { inner: 0.3, outer: 1.08, strength: 0.74 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);
    const level = createMassDriverGameplay(bus);
    const state = level.runState;

    let runTime = 0;
    let now = 0;
    let shotTriggered = false;
    let calloutUntil = -1;
    let calloutIndex = 0;
    let reportedInterlocks = 0;
    const timed = [
      { at: MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.warning), text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: MASS_DRIVER_TIME.barSeconds * 1.4 },
      { at: MASS_DRIVER_TIME.bar(21), text: 'CHARGE 60%', hold: 1.5 },
      { at: MASS_DRIVER_TIME.bar(24), text: 'CHARGE 85%', hold: 1.5 },
      { at: MASS_DRIVER_TIME.bar(26), text: 'CHARGE CRITICAL', hold: MASS_DRIVER_TIME.barSeconds * 1.35 },
    ];
    const say = (text: string, hold = 1.8) => { hud.setCallout(text); calloutUntil = now + hold; };

    bus.on('runstart', () => { runTime = 0; shotTriggered = false; calloutIndex = 0; reportedInterlocks = 0; calloutUntil = -1; hud.setCallout(''); });
    bus.on('kill', () => {
      // Gameplay updates this state in an earlier bus subscription.
      if (state.interlocksCleared <= reportedInterlocks) return;
      reportedInterlocks = state.interlocksCleared;
      if (state.interlocksCleared < 6) say(`INTERLOCKS ${state.interlocksCleared}/6`, 1.0);
    });
    bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') say('INTERLOCKS CLEAR — BRACE FOR SHOT', 3.2); });

    const game = createLockOnRunner({
      scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: `${startTip} • Sweep the rim. Intercept unstable arc bolts. Clear all six clamps before the shot.`,
      level: {
        ...level,
        updateCameraEffects({ camera: runCamera, runTime: gameRunTime, dt }) {
          updateCameraEffects(dt, { camera: runCamera, runTime: gameRunTime, running: true, feel });
        },
      },
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive },
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        const running = game.state === 'running';
        if (running) {
          runTime += dt;
          while (calloutIndex < timed.length && runTime >= timed[calloutIndex].at) {
            const callout = timed[calloutIndex++];
            if (state.interlocksCleared < 6) say(callout.text, callout.hold);
          }
          if (!shotTriggered && runTime >= MASS_DRIVER_SHOT_TIME) {
            shotTriggered = true;
            state.shotResolved = true;
            state.gunFired = state.interlocksCleared === 6;
            triggerShot(state.gunFired);
            say(state.gunFired ? 'PAYLOAD AWAY' : 'CHARGE CONTAINMENT FAILED', state.gunFired ? 2.6 : 3.4);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) { calloutUntil = -1; hud.setCallout(''); }
        game.update(dt);
        updateVisuals(dt, { camera, elapsed, runTime, running: game.state === 'running' });
      },
      dispose() { feel.dispose(); game.dispose(); disposeVisuals(); hud.setCallout(''); },
    };
  },
};
