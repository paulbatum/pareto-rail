import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhookGameplay, SKYHOOK_LOYY_BPM, SKYHOOK_LOYY_MARKERS } from './gameplay';
import { SKYHOOK_LOYY_SECTIONS, SKYHOOK_LOYY_TIME } from './timing';
import { composeSkyhookOutput } from './visuals/post-fx';
import {
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

export const skyhookLoyyLevel: LevelDefinition = {
  id: 'skyhook-loyy',
  title: 'Skyhook',
  description: 'Ride a climber car from storm cloud to orbit and cut a tether crawler loose before it reaches you.',
  bpm: SKYHOOK_LOYY_BPM,
  markers: SKYHOOK_LOYY_MARKERS,
  sections: SKYHOOK_LOYY_SECTIONS.map((section) => ({ name: section.name, time: SKYHOOK_LOYY_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x010308,
    bloom: { strength: 0.26, threshold: 0.94, radius: 0.07 },
    vignette: { inner: 0.28, outer: 1.05, strength: 0.62 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);
    let runTime = 0;
    let lastElapsed = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    const callouts = [
      { at: SKYHOOK_LOYY_MARKERS.cloudbreak - 0.35, text: 'CLOUDBREAK', hold: 2.1 },
      { at: SKYHOOK_LOYY_MARKERS.vacuum, text: 'EXOSPHERE', hold: 2.0 },
      { at: SKYHOOK_LOYY_MARKERS.boss, text: 'TETHER CONTACT — CUT IT LOOSE', hold: 3.0 },
      { at: SKYHOOK_LOYY_MARKERS.dock, text: 'STATION CAPTURE', hold: 2.8 },
    ];
    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = lastElapsed + hold;
    };
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('ANCHORS SEVERED — CORE OPEN', 2.4);
      if (phase === 'destroyed') say('TETHER CLEAR', 2.8);
    });
    bus.on('playerhit', ({ healthRemaining }) => say(`CAR INTEGRITY ${healthRemaining}/6`, 1.4));

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip: `${startTip} Defend the climber car. Intercept falling debris.`,
      level: createSkyhookGameplay(bus),
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
        lastElapsed = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout];
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
