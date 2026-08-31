import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhook7631Gameplay } from './gameplay';
import {
  SKYHOOK_7631_BPM,
  SKYHOOK_7631_MARKERS,
  SKYHOOK_7631_RUN_SECTIONS,
  SKYHOOK_7631_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects,
  updateVisuals,
} from './visuals';

export const skyhook7631Level: LevelDefinition = {
  id: 'skyhook-7631',
  title: 'Skyhook',
  description: 'Ride a storm-battered climber into orbit and cut a cable-eating siege machine off the tether before it reaches the car.',
  bpm: SKYHOOK_7631_BPM,
  markers: SKYHOOK_7631_MARKERS,
  sections: SKYHOOK_7631_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SKYHOOK_7631_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x151c22,
    bloom: { strength: 0.62, threshold: 0.82, radius: 0.12 },
    vignette: { inner: 0.38, outer: 1.08, strength: 0.56 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    const callouts = [
      { at: SKYHOOK_7631_TIME.bar(0.4), text: 'ASCENT CLAMPED · STORM LAYER', hold: 2.2 },
      { at: SKYHOOK_7631_MARKERS.cloudbreak, text: 'CLOUD DECK CLEAR', hold: 2.2 },
      { at: SKYHOOK_7631_MARKERS.thinAir, text: 'AIR 18% · AUDIO LINK THINNING', hold: 2.5 },
      { at: SKYHOOK_7631_MARKERS.orbitalNight, text: 'VACUUM', hold: 1.8 },
      { at: SKYHOOK_7631_MARKERS.docking, text: 'STATION CAPTURE · THROTTLE ZERO', hold: 3.8 },
    ];
    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + hold;
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('playerhit', ({ healthRemaining }) => {
      say(`CLIMBER IMPACT · INTEGRITY ${healthRemaining}/4`, 1.5);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('CABLE REAVER · DESCENDING', 2.4);
      else if (phase === 'exposed') say('WINCH CORE EXPOSED', 2.0);
      else say('TETHER CLEAR · DOCKING VECTOR', 3.0);
    });

    const gameplay = createSkyhook7631Gameplay(bus);
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
        updateCameraEffects({ camera: activeCamera, runTime: activeRunTime, dt }) {
          updateCameraEffects(dt, {
            camera: activeCamera,
            runTime: activeRunTime,
            running: true,
            feel,
          });
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
        const running = game.state === 'running';
        if (running) {
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
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running' });
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
