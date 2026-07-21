import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { BOSS_LATCH_TIME, CLOUDBREAK_TIME, createSkyhookGameplay, DOCK_TIME, SKYHOOK_BPM, THIN_TIME } from './gameplay';
import { SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME } from './timing';
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

export const skyhookP46cLevel: LevelDefinition = {
  id: 'skyhook-p46c',
  title: 'Skyhook',
  description: 'Ride a climber car up the space elevator and defend it to the station.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SKYHOOK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x05060a,
    bloom: { strength: 0.95, threshold: 0.6, radius: 0.16 },
    vignette: { inner: 0.34, outer: 1.1, strength: 0.7 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the climb's waypoints get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: CLOUDBREAK_TIME - 1.9, text: 'CLOUD DECK', hold: 1.7 },
      { at: THIN_TIME - 0.2, text: 'AIR THINNING', hold: 2.2 },
      { at: DOCK_TIME + 1.2, text: 'HIGHPOINT STATION — DOCKING', hold: 3.2 },
      { at: BOSS_LATCH_TIME + 600, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let bossIdSeen = -1;
    let grapplerWarned = false;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'ripper') {
        bossIdSeen = enemyId;
        say('TETHERJACK — CUT IT LOOSE', 3.0);
      } else if (kind === 'grappler' && !grapplerWarned) {
        grapplerWarned = true;
        say('GRAPPLER ON THE HULL — CHECK THE DECK', 2.6);
      }
    });
    bus.on('stage', ({ enemyId }) => {
      if (enemyId === bossIdSeen) say('CARAPACE SHED — IT CLIMBS FASTER', 2.4);
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === bossIdSeen) say('TETHER CLEAR', 2.6);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      bossIdSeen = -1;
      grapplerWarned = false;
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
        ...createSkyhookGameplay(bus),
        updateCameraEffects({ camera, runTime, dt }) {
          updateSkyhookCameraEffects(dt, { camera, runTime, running: true, feel: cameraFeel });
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
