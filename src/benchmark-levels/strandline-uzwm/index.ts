import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineUzwmGameplay } from './gameplay';
import {
  STRANDLINE_UZWM_BARS,
  STRANDLINE_UZWM_BPM,
  STRANDLINE_UZWM_RUN_SECTIONS,
  STRANDLINE_UZWM_TIME,
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
  updateCameraEffects as updateStrandlineCameraEffects,
  updateVisuals,
} from './visuals';
import { composeStrandlineOutput } from './visuals/post-fx';

export const strandlineUzwmLevel: LevelDefinition = {
  id: 'strandline-uzwm',
  title: 'Strandline',
  description:
    'Free a gigantic jellyfish from its parasites: thread the glowing strand forest, glimpse the bell, and tear the brood-mother loose from the crown.',
  bpm: STRANDLINE_UZWM_BPM,
  markers: STRANDLINE_UZWM_TIME.markers({
    drift: STRANDLINE_UZWM_BARS.drift,
    vista1: STRANDLINE_UZWM_BARS.vista1,
    thicket: STRANDLINE_UZWM_BARS.thicket,
    vista2: STRANDLINE_UZWM_BARS.vista2,
    wake: STRANDLINE_UZWM_BARS.wake,
    crown: STRANDLINE_UZWM_BARS.crown,
    boss: STRANDLINE_UZWM_BARS.boss,
    coda: STRANDLINE_UZWM_BARS.coda,
  }),
  sections: STRANDLINE_UZWM_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: STRANDLINE_UZWM_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x06283d,
    bloom: { strength: 0.8, threshold: 0.35, radius: 0.62 },
    vignette: { inner: 0.34, outer: 1.1, strength: 0.6 },
    composeOutput: composeStrandlineOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Narration: the water's waypoints get names. Gameplay owns the fight;
    // this only watches the clock and the bus.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    const timedCallouts = [
      { at: STRANDLINE_UZWM_TIME.bar(6) - 1.5, text: 'THE BELL', hold: 1.9 },
      { at: STRANDLINE_UZWM_TIME.bar(14) - 1.5, text: 'THE GREEN MOON', hold: 2.0 },
      { at: STRANDLINE_UZWM_TIME.bar(16) + 0.1, text: 'THE WATER WAKES', hold: 2.0 },
      { at: STRANDLINE_UZWM_TIME.bar(28) + 0.6, text: 'DRIFT ON', hold: 2.6 },
      { at: Number.POSITIVE_INFINITY, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;

    let darterSeen = false;
    let parentDead = false;
    bus.on('spawn', ({ kind }) => {
      if (kind === 'darter' && !darterSeen) {
        darterSeen = true;
        say('STINGERS — SHOOT THE THORNS', 2.6);
      }
      if (kind === 'parent') say('THE PARENT — STARVE ITS WEBS', 3.2);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed' && !parentDead) say('BARE — TEAR IT LOOSE', 2.6);
      if (phase === 'destroyed') {
        parentDead = true;
        say('CLEAN — EVERY STRAND GLOWS', 3.4);
      }
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      darterSeen = false;
      parentDead = false;
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
        ...createStrandlineUzwmGameplay(bus),
        updateCameraEffects({ camera, runTime, runProgress, dt }) {
          updateStrandlineCameraEffects({ camera, runTime, runProgress, dt });
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
        updateVisuals(dt, { scene, camera, elapsed, runTime, running });
      },
      dispose() {
        game.dispose();
      },
    };
  },
};
