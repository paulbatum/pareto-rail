import { MathUtils } from 'three';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay, MASS_DRIVER_BPM } from './gameplay';
import { massDriverRunState } from './state';
import {
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_RUN_SECTIONS,
  MASS_DRIVER_TIME,
  massDriverSpeedFactorAt,
  SHOT_TIME,
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
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverDetailedM6vtLevel: LevelDefinition = {
  id: 'mass-driver-detailed-m6vt',
  title: 'Mass Driver',
  description: 'Ride the payload down an orbital railgun — one accelerator ring per beat, and the firing charge is already building.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: MASS_DRIVER_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x010204,
    bloom: { strength: 0.85, threshold: 0.6, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.05, strength: 0.62 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    // HUD narration: timed callouts frame the deadline; interlock kills tick a
    // counter. Gameplay owns the fight; this only watches the clock and bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const bar = (n: number, beat = 0) => MASS_DRIVER_TIME.bar(n, beat);
    type TimedCallout = { at: number; hold: number; text: () => string | null };
    const chargeCallout = (text: string) => () => (massDriverRunState.interlocksDown < 6 ? text : null);
    const timedCallouts: TimedCallout[] = [
      { at: bar(19), hold: 2.4, text: () => 'WARNING — SAFETY INTERLOCKS JAMMED' },
      { at: bar(22), hold: 1.8, text: chargeCallout('CHARGE 60%') },
      { at: bar(24), hold: 1.8, text: chargeCallout('CHARGE 85%') },
      { at: bar(26), hold: 2.2, text: chargeCallout('CHARGE CRITICAL') },
      { at: SHOT_TIME + 0.6, hold: 2.6, text: () => (massDriverRunState.outcome === 'fired' ? 'PAYLOAD AWAY' : null) },
    ];
    let nextCallout = 0;

    bus.on('kill', () => {
      const down = massDriverRunState.interlocksDown;
      if (down > 0 && down < 6 && massDriverRunState.interlocksAlive >= 0 && runTime < SHOT_TIME) {
        // Only narrate interlock kills; scoreForKill bumped the counter just
        // before this event fired, so a change means this kill was a clamp.
        if (down !== lastInterlockCallout) {
          lastInterlockCallout = down;
          say(`INTERLOCKS ${down}/6`, 1.6);
        }
      } else if (down >= 6 && lastInterlockCallout !== 6) {
        lastInterlockCallout = 6;
        say('INTERLOCKS CLEAR — BRACE FOR SHOT', 3);
      }
    });
    let lastInterlockCallout = 0;

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      lastInterlockCallout = 0;
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
        updateCameraEffects({ camera, curve, runTime: t, runProgress, dt }) {
          void dt;
          // Bank subtly into the weave — a cosmetic roll only — and breathe
          // the FOV with airspeed.
          const tangent = curve.getTangentAt(MathUtils.clamp(runProgress, 0, 1));
          camera.rotateZ(-tangent.x * 1.15);
          const factor = massDriverSpeedFactorAt(t);
          feel.setFovOffset(MathUtils.clamp((factor - 0.46) * 3.2, 0, 14), { response: 3 });
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
            const text = callout.text();
            if (text) say(text, callout.hold);
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, feel, elapsed, runTime, running });
        // The barrel rings like metal: quick and tight, more roll than pitch.
        feel.update(dt, { shake: { frequency: 12, rollDegrees: 1.1, pitchDegrees: 0.22, yawDegrees: 0.18 } });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
