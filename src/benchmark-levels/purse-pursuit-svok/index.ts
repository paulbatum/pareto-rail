import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import type { LevelDefinition } from '../../engine/types';
import { createAudio } from './audio';
import { createPursePursuitGameplay } from './gameplay';
import { composePurseOutput } from './post-fx';
import {
  PURSE_BPM,
  PURSE_MARKERS,
  PURSE_RUN_SECTIONS,
  PURSE_TIME,
  purseSpeedFactorAt,
} from './timing';
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

export const pursePursuitSvokLevel: LevelDefinition = {
  id: 'purse-pursuit-svok',
  title: 'Purse Pursuit',
  description: 'A motorcycle gang took your purse. Lean out the window and take it back.',
  bpm: PURSE_BPM,
  markers: { ...PURSE_MARKERS },
  sections: PURSE_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: PURSE_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x03040c,
    // Restrained bloom: the frame is full of small hot lights (tail lights,
    // lamp heads, lane dashes) and a heavy bloom turns the highway into soup.
    bloom: { strength: 0.62, threshold: 0.62, radius: 0.42 },
    vignette: { inner: 0.34, outer: 1.05, strength: 0.55 },
    composeOutput: composePurseOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // The boss fight narrates itself. Gameplay owns the phases; this just
    // shouts them.
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('SHE HAS YOUR PURSE', 2.6);
      if (phase === 'exposed') say('CHROME OFF', 1.8);
      if (phase === 'destroyed') say('GOT IT', 3.4);
    });
    bus.on('runstart', () => {
      calloutUntil = -1;
      hud.setCallout('');
    });

    const gameplay = createPursePursuitGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: gameplay,
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        setEnemyDenied,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    // The runner keeps run time private, so mirror it here: the visuals need it
    // for the set pieces that are cued off bars rather than off events.
    let runTime = 0;
    bus.on('runstart', () => {
      runTime = 0;
    });

    return {
      update(dt, elapsed) {
        now = elapsed;
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        if (game.state === 'running') runTime = Math.min(gameplay.duration, runTime + dt);
        game.update(dt);

        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          runTime,
          running: game.state === 'running',
          speedFactor: purseSpeedFactorAt(runTime),
          runProgress: game.runProgress,
        });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
        disposeVisuals();
      },
    };
  },
};
