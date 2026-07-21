import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  barrelBreached,
  createMassDriverGameplay,
  gunFired,
  interlocksTotal,
} from './gameplay';
import { CHARGE_TIME, MD_BPM, MD_MARKERS, MD_RUN_SECTIONS, MD_TIME } from './timing';
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

export const massDriverO9okLevel: LevelDefinition = {
  id: 'mass-driver-o9ok',
  title: 'Mass Driver',
  description: 'Ride the payload down an orbital railgun. One coil per beat, all the way to the muzzle.',
  bpm: MD_BPM,
  markers: MD_MARKERS,
  sections: MD_RUN_SECTIONS.map((section) => ({ name: section.name, time: MD_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x01020a,
    bloom: { strength: 0.95, threshold: 0.7, radius: 0.24 },
    vignette: { inner: 0.32, outer: 1.05, strength: 0.7 },
    composeOutput: composeMassDriverOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration. Gameplay owns the fight; this only watches the clock and the
    // bus, and it only speaks when the state of the gun actually changes.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    let announcedJam = false;
    let announcedClear = false;
    let announcedResult = false;
    let cleared = 0;
    const interlockIds = new Set<number>();

    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };

    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'interlock') interlockIds.add(enemyId);
    });

    bus.on('kill', ({ enemyId }) => {
      if (!interlockIds.delete(enemyId)) return;
      cleared += 1;
      const remaining = interlocksTotal() - cleared;
      if (remaining > 0) say(`INTERLOCK DOWN — ${remaining} LEFT`, 1.5);
    });

    bus.on('runstart', () => {
      runTime = 0;
      cleared = 0;
      announcedJam = false;
      announcedClear = false;
      announcedResult = false;
      interlockIds.clear();
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
      // Gameplay owns the camera-effects hook (it is where the run's phase
      // clock ticks); the runtime injects only the cosmetic half.
      level: createMassDriverGameplay(bus, ({ camera: runCamera, runTime: time, dt }) => {
        updateMassDriverCameraEffects(dt, { camera: runCamera, runTime: time, running: true, feel: cameraFeel });
      }),
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
        if (game.state === 'running') {
          runTime += dt;
          if (!announcedJam && runTime >= CHARGE_TIME - 1.2) {
            announcedJam = true;
            say('SAFETIES JAMMED — CLEAR THE INTERLOCKS', 3.0);
          }
          if (!announcedClear && announcedJam && interlocksTotal() > 0 && cleared >= interlocksTotal()) {
            announcedClear = true;
            say('BARREL CLEAR — BRACE', 2.4);
          }
          if (!announcedResult && (gunFired() || barrelBreached())) {
            announcedResult = true;
            say(gunFired() ? 'FIRE' : 'BARREL BREACH', 3.2);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          running: game.state === 'running',
          feel: cameraFeel,
        });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
