import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import { BELL_REVEAL_TIME, PARENT_TIME, STRANDLINE_BPM, STRANDLINE_MARKERS, STRANDLINE_RUN_SECTIONS, STRANDLINE_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { strandlinePost } from './visuals/post-fx';

export const strandlineO848Level: LevelDefinition = {
  id: 'strandline-o848',
  title: 'Strandline',
  description: 'Ride the strands of a gigantic jellyfish, burn the parasites off it, and tear the parent loose from the crown.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_TIME.bar(section.fromBar),
  })),
  post: strandlinePost,
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    // Narration: the run's set pieces get names.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: BELL_REVEAL_TIME - 1.4, text: 'OPEN WATER', hold: 2.2 },
      { at: PARENT_TIME + 0.2, text: 'THE PARENT', hold: 2.6 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    const panelIds = new Set<number>();
    let parentId = -1;
    let parentSpawned = false;
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'panel') panelIds.add(enemyId);
      if (kind === 'parent') {
        parentId = enemyId;
        parentSpawned = true;
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THE WEBBING DIES BACK', 1.8);
      if (phase === 'exposed' && parentSpawned) say('TEAR IT LOOSE', 2.4);
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === parentId) say('STRANDLINE CLEAN', 3.4);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      panelIds.clear();
      parentId = -1;
      parentSpawned = false;
      hud.setCallout('');
    });

    const gameplay = createStrandlineGameplay(bus);
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
        updateCameraEffects({ camera: cam, runTime: rt, dt }) {
          updateStrandlineCameraEffects(dt, { camera: cam, runTime: rt, running: true, feel: cameraFeel });
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
