import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { createSkyhookGameplay } from './gameplay';
import { SKYHOOK_BPM, SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateSkyhookCameraEffects,
  updateVisuals,
} from './visuals';
import { skyhookPost } from './visuals/post-fx';

export const skyhookLkorLevel: LevelDefinition = {
  id: 'skyhook-lkor',
  title: 'Skyhook',
  description: 'Ride a climber car up the space elevator, from the storm at its base to the station at the top of the sky, and keep the car alive the whole way.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({ name: section.name, time: SKYHOOK_TIME.bar(section.fromBar) })),
  post: skyhookPost,
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = runTime + seconds;
    };
    const timedCallouts: Array<{ at: number; message: string; seconds: number }> = [
      { at: SKYHOOK_MARKERS.cloudPunch - 1.2, message: 'CLOUD DECK', seconds: 2.2 },
      { at: SKYHOOK_MARKERS.bossClank, message: 'TETHER CONTACT — THE LAMPREY', seconds: 3 },
      { at: SKYHOOK_MARKERS.dockSeal, message: 'DOCKED', seconds: 2.6 },
    ];
    let nextCallout = 0;
    let calloutUntil = -1;
    let runTime = 0;

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') say('LAMPREY LOOSE — CLEAR TO DOCK', 3);
    });

    const gameplay = createSkyhookGameplay(bus);
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
        updateCameraEffects({ camera: effectsCamera, runTime: effectsRunTime, dt }) {
          updateSkyhookCameraEffects(dt, { camera: effectsCamera, runTime: effectsRunTime, running: true, feel: cameraFeel });
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
        const running = game.state === 'running';
        if (running) {
          runTime += dt;
          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            say(callout.message, callout.seconds);
            nextCallout += 1;
          }
          if (calloutUntil >= 0 && runTime >= calloutUntil) {
            hud.setCallout('');
            calloutUntil = -1;
          }
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running, feel: cameraFeel });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
