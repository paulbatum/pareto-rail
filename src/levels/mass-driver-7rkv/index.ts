import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createMassDriverGameplay } from './gameplay';
import { MASS_DRIVER_BPM, MASS_DRIVER_MARKERS, MASS_DRIVER_SECTIONS, MASS_DRIVER_TIME } from './timing';
import {
  createEnemyMesh, createEnvironment, createProjectileMesh, createReticle,
  installVisualEventHandlers, setEnemyDenied, setEnemyLocked, setReticleActive,
} from './visuals';

export const massDriver7rkvLevel: LevelDefinition = {
  id: 'mass-driver-7rkv',
  title: 'Mass Driver',
  description: 'Ride an orbital payload through a beat-synchronized accelerator and clear its jammed safeties before the firing charge peaks.',
  bpm: MASS_DRIVER_BPM,
  markers: MASS_DRIVER_MARKERS,
  sections: MASS_DRIVER_SECTIONS.map((section) => ({ name: section.name, time: MASS_DRIVER_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x01030a,
    bloom: { strength: 1.05, threshold: 0.62, radius: 0.16 },
    vignette: { inner: 0.38, outer: 1.06, strength: 0.72 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const environment = createEnvironment(scene);
    const effects = installVisualEventHandlers(bus, scene);
    const feel = createCameraFeel(camera);
    let runTime = 0;
    let calloutRemaining = 0;
    let interlocks = 0;
    const liveInterlockIds = new Set<number>();
    let nextCallout = 0;
    const callouts = [
      { at: MASS_DRIVER_TIME.bar(0.4), text: 'PAYLOAD CAPTURED' },
      { at: MASS_DRIVER_TIME.bar(8), text: 'INDUCTION: LOCKED' },
      { at: MASS_DRIVER_TIME.bar(16), text: 'COMPRESSION FIELD' },
      { at: MASS_DRIVER_TIME.bar(27), text: 'SAFETY BUS: JAMMED' },
      { at: MASS_DRIVER_TIME.bar(28), text: 'DESTROY 6 INTERLOCKS' },
    ];
    const say = (text: string, hold = 2.2) => { hud.setCallout(text); calloutRemaining = hold; };

    bus.on('runstart', () => {
      runTime = 0; interlocks = 0; nextCallout = 0; calloutRemaining = 0;
      liveInterlockIds.clear();
      hud.setCallout('');
      feel.restore();
    });
    bus.on('beat', ({ isDownbeat }) => {
      if (isDownbeat) feel.shake(runTime > MASS_DRIVER_TIME.bar(28) ? 0.11 : 0.035, { maxTrauma: 0.55, decay: 3.8 });
    });
    bus.on('fire', ({ volleySize, indexInVolley }) => {
      if ((indexInVolley ?? 0) === 0) feel.kickFov(volleySize === 6 ? 2.4 : 0.8, { decay: 6 });
    });
    bus.on('kill', () => feel.shake(0.07, { maxTrauma: 0.65, decay: 3.2 }));
    bus.on('stage', () => feel.shake(0.13, { maxTrauma: 0.75, decay: 2.8 }));
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') { interlocks += 1; liveInterlockIds.add(enemyId); }
    });
    bus.on('kill', ({ enemyId }) => {
      if (liveInterlockIds.delete(enemyId) && interlocks > 0) {
        interlocks -= 1;
        say(interlocks > 0 ? `${interlocks} SAFETIES REMAIN` : 'SAFETIES CLEAR — FIRE', interlocks > 0 ? 1.1 : 3.4);
        if (interlocks === 0) feel.kickFov(6, { decay: 1.2 });
      }
    });
    bus.on('playerhit', () => { say('CONTAINMENT FAILURE', 4); feel.shake(0.8, { maxTrauma: 1, decay: 0.35 }); });
    bus.on('runend', ({ died }) => {
      say(died ? 'BARREL RUPTURE' : 'MUZZLE CLEAR — ORBITAL INSERTION', 5);
      if (!died) feel.kickFov(9, { decay: 0.75 });
    });

    const gameplay = createMassDriverGameplay(bus);
    const game = createLockOnRunner({
      scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip,
      level: {
        ...gameplay,
        updateCameraEffects({ runTime: time, runProgress, dt }) {
          const charge = Math.max(0, (time - MASS_DRIVER_TIME.bar(27)) / (MASS_DRIVER_TIME.bar(36) - MASS_DRIVER_TIME.bar(27)));
          feel.setFovOffset(runProgress * 7 + charge * 4, { response: 4.2 });
          feel.update(dt, { shake: { frequency: 9 + charge * 12, rollDegrees: 0.7 + charge * 1.4 } });
        },
      },
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive },
    });

    return {
      update(dt) {
        const running = game.state === 'running';
        if (running) {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            say(callouts[nextCallout].text);
            nextCallout += 1;
          }
        }
        if (calloutRemaining > 0) {
          calloutRemaining -= dt;
          if (calloutRemaining <= 0) hud.setCallout('');
        }
        game.update(dt);
        environment.update(dt, runTime, running);
        effects.update(dt);
      },
      dispose() {
        feel.dispose(); game.dispose(); effects.dispose(); environment.dispose();
      },
    };
  },
};
