import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  CLOUDBREAK_TIME,
  createSkyhookGgl2Gameplay,
  DESCENT_TIME,
  DOCK_TIME,
  SKYHOOK_GGL2_BPM,
  SKYHOOK_MARKERS,
  SKYHOOK_RUN_SECTIONS,
  SKYHOOK_GGL2_TIME,
  THIN_TIME,
} from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateSkyhookCameraEffects,
  updateVisuals,
} from './visuals';
import { composeSkyhookOutput } from './visuals/post-fx';

export const skyhookGgl2Level: LevelDefinition = {
  id: 'skyhook-ggl2',
  title: 'Skyhook',
  description: 'Ride a climber car up a space elevator from the weather to the station, and kill the thing that comes down the tether.',
  bpm: SKYHOOK_GGL2_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({ name: section.name, time: SKYHOOK_GGL2_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x2b2f36,
    bloom: { strength: 0.8, threshold: 0.62, radius: 0.2 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.62 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the climb's landmarks get names. Gameplay owns the fight; this
    // watches the clock and the bus.
    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: CLOUDBREAK_TIME - 1.6, text: 'PUNCH THROUGH', hold: 2.0 },
      { at: THIN_TIME - 0.1, text: 'THE AIR THINS', hold: 2.2 },
      { at: DOCK_TIME + 40, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;
    let dockAnnounced = false;

    let bossId = -1;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'descender') {
        bossId = enemyId;
        say('THE DESCENDER — KILL IT BEFORE IT REACHES THE CAR', 3.4);
      }
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === bossId) say('DESCENDER DOWN — DOCK THE CAR', 3.2);
    });
    bus.on('playerhit', () => {
      if (runTime >= DESCENT_TIME) say('THE CAR IS TAKING DAMAGE', 1.4);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      dockAnnounced = false;
      calloutUntil = -1;
      hud.setCallout('');
    });

    const skyhookGameplay = createSkyhookGgl2Gameplay(bus);
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
        ...skyhookGameplay,
        updateCameraEffects({ camera, runTime: rt, dt }) {
          updateSkyhookCameraEffects(dt, { camera, runTime: rt, running: true, feel: cameraFeel });
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
            say(timedCallouts[nextCallout].text, timedCallouts[nextCallout].hold);
            nextCallout += 1;
          }
          if (!dockAnnounced && runTime >= DOCK_TIME) {
            dockAnnounced = true;
            say('DOCKING', 3.0);
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
