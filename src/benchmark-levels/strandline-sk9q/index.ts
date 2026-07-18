import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createCameraFeel } from '../../engine/camera-feel';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import { STRANDLINE_SK9Q_BARS, STRANDLINE_SK9Q_BPM, STRANDLINE_SK9Q_MARKERS, STRANDLINE_SK9Q_RUN_SECTIONS, STRANDLINE_SK9Q_TIME, bar } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { strandlinePost } from './visuals/post-fx';

export const strandlineSk9qLevel: LevelDefinition = {
  id: 'strandline-sk9q',
  title: 'Strandline',
  description:
    'Fly the strand forest of a gigantic jellyfish and pick the violet parasites off it — then tear the parent organism from the crown and watch the whole animal glow clean.',
  bpm: STRANDLINE_SK9Q_BPM,
  markers: STRANDLINE_SK9Q_MARKERS,
  sections: STRANDLINE_SK9Q_RUN_SECTIONS.map((section) => ({ name: section.name, time: STRANDLINE_SK9Q_TIME.bar(section.fromBar) })),
  post: strandlinePost,
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
      { at: bar(STRANDLINE_SK9Q_BARS.reveal1), message: 'THE BELL — A GREEN MOON', seconds: 2.6 },
      { at: bar(STRANDLINE_SK9Q_BARS.reveal2), message: 'THE CROWN — SOMETHING IS DUG IN', seconds: 2.8 },
      { at: bar(STRANDLINE_SK9Q_BARS.parent) + 0.3, message: 'THE PARENT — KILL ITS BROODS', seconds: 3.2 },
    ];
    let nextCallout = 0;
    let calloutUntil = -1;
    let runTime = 0;
    let exposedCount = 0;

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      exposedCount = 0;
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') {
        exposedCount += 1;
        if (exposedCount === 3) say('BARE — TEAR IT LOOSE', 2.8);
      } else if (phase === 'destroyed') {
        say('CLEANSED — IT DRIFTS ON', 3.4);
      }
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
        startWord: 'CLEANSE',
        replayWord: 'RETURN',
        updateCameraEffects({ camera: effectsCamera, runTime: effectsRunTime, dt }) {
          updateStrandlineCameraEffects(dt, { camera: effectsCamera, runTime: effectsRunTime, running: true, feel: cameraFeel });
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
