import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay, massDriverSpeedAt, type MassDriverRunState } from './gameplay';
import {
  MASS_DRIVER_BPM,
  MASS_DRIVER_MARKERS,
  MASS_DRIVER_SECTIONS,
  MASS_DRIVER_TIME,
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
  setRunState,
  triggerInterlockStrobe,
  triggerShotFlash,
  updateVisuals,
} from './visuals';
import { composeMassDriverOutput } from './visuals/post-fx';

export const massDriverDetailed7k2pLevel: LevelDefinition = {
  id: 'mass-driver-detailed-7k2p',
  title: 'Mass Driver',
  description: 'Ride the payload through a beat-locked orbital railgun and clear six jammed interlocks before the firing charge peaks.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_SECTIONS.map((section) => ({ name: section.name, time: MASS_DRIVER_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x01030a,
    bloom: { strength: 1.0, threshold: 0.64, radius: 0.15 },
    vignette: { inner: 0.38, outer: 1.06, strength: 0.72 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, camera, feel);

    let elapsedNow = 0;
    let runTime = 0;
    let nextCallout = 0;
    let shotLanded = false;
    let calloutUntil = -1;
    let previousState: MassDriverRunState = {
      destroyedInterlocks: 0,
      interceptedArcs: 0,
      hullRemaining: 3,
      gunFired: false,
      detonated: false,
    };
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + seconds;
    };
    const timedCallouts = [
      { at: MASS_DRIVER_MARKERS.warning, text: 'WARNING — SAFETY INTERLOCKS JAMMED', hold: 2.8 },
      { at: MASS_DRIVER_TIME.bar(22), text: 'CHARGE 60%', hold: 1.4 },
      { at: MASS_DRIVER_TIME.bar(25), text: 'CHARGE 85%', hold: 1.4 },
      { at: MASS_DRIVER_TIME.bar(27), text: 'CHARGE CRITICAL', hold: 1.8 },
    ];

    const onState = (next: Readonly<MassDriverRunState>) => {
      setRunState(next);
      if (next.destroyedInterlocks > previousState.destroyedInterlocks) {
        if (next.destroyedInterlocks === 6) {
          say('INTERLOCKS CLEAR — BRACE FOR SHOT', 3.3);
          triggerInterlockStrobe();
          feel.kickFov(5.2, { decay: 1.8 });
        } else {
          say(`INTERLOCKS ${next.destroyedInterlocks}/6`, 1.15);
        }
      }
      if (!previousState.detonated && next.detonated) {
        say('CHARGE CONTAINMENT FAILED', 5);
        feel.kickFov(9, { decay: 0.48 });
        feel.shake(1.7, { maxTrauma: 2, decay: 0.42, pitchDegrees: 1.8, yawDegrees: 1.5, rollDegrees: 5.2, frequency: 17 });
      }
      previousState = { ...next };
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      shotLanded = false;
      calloutUntil = -1;
      previousState = { destroyedInterlocks: 0, interceptedArcs: 0, hullRemaining: 3, gunFired: false, detonated: false };
      hud.setCallout('');
      feel.restore();
    });

    const gameplay = createMassDriverGameplay(bus, onState);
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
        updateCameraEffects({ camera: railCamera, runTime: time, dt }) {
          const speed = massDriverSpeedAt(time);
          const shotEase = time >= MASS_DRIVER_MARKERS.shot ? Math.min(1, (time - MASS_DRIVER_MARKERS.shot) / 1.2) : 0;
          feel.setFovOffset(Math.min(12, speed * 2.1 + shotEase * 4), { response: time >= MASS_DRIVER_MARKERS.shot ? 12 : 4.5 });
          feel.update(dt, {
            shake: {
              frequency: 10 + speed * 1.4,
              pitchDegrees: 0.18 + speed * 0.035,
              yawDegrees: 0.12 + speed * 0.025,
              rollDegrees: 0.62 + speed * 0.11,
            },
          });
          const taper = time < MASS_DRIVER_MARKERS.shot ? Math.min(1, Math.max(0, (MASS_DRIVER_MARKERS.shot - time) / 5)) : 0;
          railCamera.rotateZ(Math.sin(time * 0.64) * 0.012 * taper);
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
        const runningBeforeUpdate = game.state === 'running';
        if (runningBeforeUpdate) runTime += dt;
        game.update(dt);
        if (game.state === 'running') {
          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            if (previousState.destroyedInterlocks < 6) say(callout.text, callout.hold);
            nextCallout += 1;
          }
          if (!shotLanded && runTime >= MASS_DRIVER_MARKERS.shot) {
            shotLanded = true;
            if (previousState.gunFired) {
              say('PAYLOAD AWAY', 3.4);
              triggerShotFlash();
              feel.kickFov(14, { decay: 0.72 });
              feel.shake(1.25, { maxTrauma: 1.75, decay: 1.1, pitchDegrees: 1.15, yawDegrees: 0.85, rollDegrees: 3.8, frequency: 14 });
            }
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        updateVisuals(dt, { elapsed, runTime, running: game.state === 'running', camera, feel });
      },
      dispose() {
        game.dispose();
        disposeVisuals();
        feel.dispose();
      },
    };
  },
};
