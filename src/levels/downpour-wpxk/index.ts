import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  CANAL_TIME,
  createDownpourGameplay,
  DOWNPOUR_BPM,
  GUNSHIP_REVEAL_TIME,
  HUNT_TIME,
  PLUNGE_TIME,
  SUMMIT_TIME,
  UNDERCITY_TIME,
} from './gameplay';
import { DOWNPOUR_MARKERS, DOWNPOUR_RUN_SECTIONS, DOWNPOUR_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateDownpourCameraEffects,
  updateVisuals,
} from './visuals';
import { composeDownpourOutput } from './visuals/post-fx';

export const downpourWpxkLevel: LevelDefinition = {
  id: 'downpour-wpxk',
  title: 'Downpour',
  description: 'Outrun the city that wants its package back.',
  bpm: DOWNPOUR_BPM,
  markers: DOWNPOUR_MARKERS,
  sections: DOWNPOUR_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: DOWNPOUR_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x04060c,
    bloom: { strength: 1.1, threshold: 0.55, radius: 0.2 },
    vignette: { inner: 0.34, outer: 1.1, strength: 0.8 },
    composeOutput: composeDownpourOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the run's districts get names. Gameplay owns the chase; this
    // only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: PLUNGE_TIME - 2.0, text: 'THE PLUNGE', hold: 2.0 },
      { at: UNDERCITY_TIME - 0.2, text: 'THE UNDERCITY', hold: 2.2 },
      { at: CANAL_TIME - 0.2, text: 'THE CANAL', hold: 2.0 },
      { at: GUNSHIP_REVEAL_TIME + 0.4, text: 'IT FOUND YOU', hold: 2.4 },
      { at: HUNT_TIME, text: 'THE HUNT', hold: 2.2 },
      { at: SUMMIT_TIME + 0.6, text: 'ABOVE THE STORM', hold: 2.6 },
      { at: SUMMIT_TIME + 999, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let gunshipId = -1;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'gunship') gunshipId = enemyId;
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === gunshipId) say('HUNTER DOWN', 2.6);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      gunshipId = -1;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const gameplay = createDownpourGameplay(bus);
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
        updateCameraEffects({ runTime, dt }) {
          updateDownpourCameraEffects(dt, { camera, runTime, running: true, feel: cameraFeel });
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
          while (nextCallout < timedCallouts.length - 1 && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
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
