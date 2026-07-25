import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createThermalGameplay, THERMAL_INK_BPM } from './gameplay';
import { INK_MARKERS, INK_TIME, INK_WINDOWS, THERMAL_RUN_SECTIONS } from './timing';
import {
  composeThermalOutput,
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

export const thermalInkLevel: LevelDefinition = {
  id: 'thermal-ink-yk97',
  title: 'Thermal Ink',
  description: 'One continuous octopus fight in a drowned harbor: lose it in the ink, kill it in infrared.',
  bpm: THERMAL_INK_BPM,
  markers: INK_MARKERS,
  sections: THERMAL_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: INK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x1d1207,
    bloom: { strength: 0.85, threshold: 0.6, radius: 0.16 },
    vignette: { inner: 0.32, outer: 1.05, strength: 0.68 },
    composeOutput: composeThermalOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Narration: the mode changes and the arm count get names. Gameplay owns
    // the fight; this watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: 0.6, text: 'IT HAS THE HARBOR', hold: 2.2 },
      { at: INK_WINDOWS[0].from, text: 'INK — SIGHT SWALLOWED', hold: 1.6 },
      { at: INK_WINDOWS[0].from + 0.95, text: 'INFRARED ACTIVE', hold: 2.0 },
      { at: INK_WINDOWS[1].from + 0.95, text: 'INFRARED', hold: 1.3 },
      { at: INK_WINDOWS[2].from, text: 'FINAL BLACKOUT', hold: 2.2 },
    ];
    let nextCallout = 0;

    const armIds = new Set<number>();
    let armsDown = 0;
    let coreId = -1;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'arm') armIds.add(enemyId);
      if (kind === 'core') coreId = enemyId;
    });
    bus.on('kill', ({ enemyId }) => {
      if (armIds.delete(enemyId)) {
        armsDown += 1;
        say(`ARM SEVERED — ${armsDown}/6`, 1.7);
      }
      if (enemyId === coreId) say('THE HARBOR IS QUIET', 3.6);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('ITS CORE GLEAMS IN THE MANTLE', 2.4);
      if (phase === 'exposed') say('CORE EXPOSED — STRIKE', 2.6);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      armIds.clear();
      armsDown = 0;
      coreId = -1;
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
      level: createThermalGameplay(bus),
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
            say(callout.text, callout.hold);
            nextCallout += 1;
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
          feel,
          elapsed,
          runTime,
          running,
          runProgress: game.runProgress,
        });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
