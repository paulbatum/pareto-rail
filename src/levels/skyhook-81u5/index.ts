import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhookGameplay } from './gameplay';
import { SKYHOOK_BPM, SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const skyhook81u5Level: LevelDefinition = {
  id: 'skyhook-81u5',
  title: 'Skyhook',
  description: 'Defend an elevator climber from the storm deck to the orbital dock.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map(({ name, fromBar }) => ({ name, time: SKYHOOK_TIME.bar(fromBar) })),
  post: {
    clearColor: 0x343b42,
    bloom: { strength: 0.62, threshold: 0.82, radius: 0.1 },
    vignette: { inner: 0.42, outer: 1.18, strength: 0.48 },
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

    const calls = [
      { at: SKYHOOK_MARKERS.cloudbreak - 0.35, text: 'CLOUD DECK', hold: 2.0 },
      { at: SKYHOOK_MARKERS.thinAir, text: 'CABIN PRESSURE HOLDING', hold: 2.2 },
      { at: SKYHOOK_MARKERS.boss, text: 'MASS ON THE TETHER', hold: 2.5 },
      { at: SKYHOOK_MARKERS.bossClose, text: 'IMPACT WINDOW CLOSING', hold: 2.4 },
      { at: SKYHOOK_MARKERS.clear, text: 'APPROACH CORRIDOR CLEAR', hold: 2.7 },
      { at: SKYHOOK_MARKERS.docked, text: 'CAPTURED — DOCKED', hold: 3.0 },
    ];
    let nextCall = 0;
    let bossId = -1;

    bus.on('runstart', () => {
      runTime = 0;
      nextCall = 0;
      bossId = -1;
      calloutUntil = -1;
      hud.setCallout('CLIMBER 07 — ASCENT COMMITTED');
      calloutUntil = elapsedNow + 2.2;
    });
    bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'boss') bossId = enemyId; });
    bus.on('kill', ({ enemyId }) => { if (enemyId === bossId) say('TETHER CLEAR — RESUME ASCENT', 3.4); });
    bus.on('playerhit', ({ healthRemaining }) => say(`CLIMBER IMPACT — INTEGRITY ${healthRemaining}`, 1.8));

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
        updateCameraEffects({ runTime: time, dt }) {
          const storm = Math.max(0, 1 - time / SKYHOOK_MARKERS.cloudbreak);
          feel.setFovOffset(storm * Math.sin(time * 1.7) * 0.45);
          if (storm > 0.1) feel.shake(dt * storm * 0.035);
          if (time > SKYHOOK_MARKERS.clear) feel.setFovOffset(-4 * Math.min(1, (time - SKYHOOK_MARKERS.clear) / 4));
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
        if (game.state === 'running') {
          runTime += dt;
          while (nextCall < calls.length && runTime >= calls[nextCall].at) {
            const call = calls[nextCall++];
            say(call.text, call.hold);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running' });
      },
      dispose() {
        feel.dispose();
        game.dispose();
        disposeEnvironment();
      },
    };
  },
};
