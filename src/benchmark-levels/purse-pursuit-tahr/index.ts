import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createPursePursuitGameplay } from './gameplay';
import { PURSE_PURSUIT_BPM, PURSE_PURSUIT_MARKERS, PURSE_PURSUIT_SECTIONS, PURSE_PURSUIT_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const pursePursuitTahrLevel: LevelDefinition = {
  id: 'purse-pursuit-tahr',
  title: 'Purse Pursuit',
  description: 'Lean out of the passenger window and fight through a neon motorcycle gang to reclaim the vivid blue purse.',
  bpm: PURSE_PURSUIT_BPM,
  markers: PURSE_PURSUIT_MARKERS,
  sections: PURSE_PURSUIT_SECTIONS.map((section) => ({ name: section.name, time: PURSE_PURSUIT_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x05030d,
    bloom: { strength: 0.74, threshold: 0.36, radius: 0.68 },
    vignette: { inner: 0.28, outer: 1.08, strength: 0.64 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timed = [
      { at: PURSE_PURSUIT_MARKERS.slipstream, text: 'WORK FORWARD THROUGH THE PACK' },
      { at: PURSE_PURSUIT_MARKERS.crossTraffic, text: 'THEY ARE CLOSING IN' },
      { at: PURSE_PURSUIT_MARKERS.overpass, text: 'UNDERPASS — HOLD ON' },
    ];
    let timedIndex = 0;
    bus.on('runstart', () => {
      runTime = 0;
      timedIndex = 0;
      calloutUntil = -1;
      hud.setCallout('GET YOUR PURSE BACK');
      calloutUntil = now + 2.2;
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('THERE — THE BLUE PURSE', 2.8);
      if (phase === 'exposed') say('BIKE IS FAILING — FINISH IT', 2.6);
      if (phase === 'destroyed') say('CAUGHT IT!  LET\'S GO', 3.6);
    });

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip: `${startTip} · SHOOT BOMBS BEFORE THEY LAND`,
      level: createPursePursuitGameplay(bus),
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
          while (timedIndex < timed.length && runTime >= timed[timedIndex].at) {
            say(timed[timedIndex].text, 2.1);
            timedIndex += 1;
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
          runProgress: game.runProgress ?? 0,
          running: game.state === 'running',
        });
        feel.setFovOffset(game.state === 'running' ? 2.2 : 0, { response: 4.5 });
        if (game.state === 'running') feel.shake(dt * 0.035, { maxTrauma: 0.35, decay: 0.2 });
        feel.update(dt, { shake: { maxTrauma: 1, decay: 1.75, pitchDegrees: 0.24, yawDegrees: 0.18, rollDegrees: 0.72, frequency: 8.5, smoothing: 20 } });
      },
      dispose() {
        game.dispose();
        feel.dispose();
        disposeVisuals();
      },
    };
  },
};
