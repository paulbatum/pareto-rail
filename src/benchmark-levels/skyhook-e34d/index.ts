import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { Quaternion } from 'three';
import { createSkyhookGameplay, SKYHOOK_BPM, SKYHOOK_PLAYER_HEALTH, viewQuaternionAt } from './gameplay';
import { bar, SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraFeel,
  updateVisuals,
} from './visuals';
import { composeSkyhookOutput } from './visuals/post-fx';

// Mission-control callouts: the altitude read-outs sell the climb, the
// contact calls sell the fight. Event calls pre-empt timed ones.
const TIMED_CALLOUTS: Array<{ at: number; text: string; hold: number }> = [
  { at: 0.25, text: 'LIFTOFF', hold: 1.6 },
  { at: bar(3), text: 'THEY\'RE GOING FOR THE CAR', hold: 2.2 },
  { at: SKYHOOK_MARKERS.punch, text: 'CLOUD DECK · 12 KM', hold: 1.8 },
  { at: bar(8, 2), text: 'ABOVE THE WEATHER', hold: 1.8 },
  { at: bar(12), text: 'STRATOSPHERE · 40 KM', hold: 2 },
  { at: bar(16), text: 'AIR THINNING', hold: 1.8 },
  { at: bar(18, 2), text: 'KÁRMÁN LINE · 100 KM', hold: 2.4 },
  { at: bar(21, 2), text: 'IT\'S CLIMBING DOWN THE LINE', hold: 2 },
  { at: SKYHOOK_MARKERS.boss, text: 'SHOOT OUT ITS GRIPS', hold: 2.2 },
  { at: bar(31), text: 'DOCKING', hold: 1.6 },
  { at: SKYHOOK_MARKERS.docked, text: 'DOCKED · 35,786 KM', hold: 3.5 },
];

export const skyhookLevel: LevelDefinition = {
  id: 'skyhook-e34d',
  title: 'Skyhook',
  description: 'Ride a climber car up a space elevator from the storm to the station, and keep it in one piece.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({ name: section.name, time: SKYHOOK_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x333538,
    bloom: { strength: 0.85, threshold: 0.82, radius: 0.22 },
    vignette: { inner: 0.42, outer: 1.15, strength: 0.5 },
    composeOutput: composeSkyhookOutput,
  },
  debugSelector: {
    queryParam: 'skyhookDebug',
    label: 'Inspect',
    options: [
      { id: 'skip-descender', title: 'Dock without the Descender' },
    ],
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    // The station and the planet sit far up the line; widen the far plane for this level.
    const previousFar = camera.far;
    camera.far = 4000;
    camera.updateProjectionMatrix();
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let now = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    let eventCalloutUntil = -1;
    let health = SKYHOOK_PLAYER_HEALTH;
    let endedFor = 0;
    const endLean = new Quaternion();
    const settled = new Quaternion();
    const say = (message: string, seconds: number, fromEvent = false) => {
      if (!fromEvent && now < eventCalloutUntil) return;
      hud.setCallout(message);
      calloutUntil = now + seconds;
      if (fromEvent) eventCalloutUntil = now + seconds;
    };

    const gameplay = createSkyhookGameplay(bus, debugValue === 'skip-descender' ? debugValue : undefined);
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      health = SKYHOOK_PLAYER_HEALTH;
      calloutUntil = -1;
      eventCalloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('playerhit', ({ healthRemaining }) => {
      health = healthRemaining;
      if (healthRemaining === 1) say('HULL CRITICAL', 1.6, true);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('CONTACT ON THE TETHER', 2.4, true);
      if (phase === 'exposed') say('THE MAW IS OPEN', 2, true);
      if (phase === 'destroyed') say('TETHER CLEAR', 2.6, true);
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
        ...gameplay,
        updateCameraEffects(context) {
          gameplay.updateCameraEffects?.(context);
          updateCameraFeel(context.dt, context.runTime, true);
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
          while (nextCallout < TIMED_CALLOUTS.length && runTime >= TIMED_CALLOUTS[nextCallout].at) {
            const callout = TIMED_CALLOUTS[nextCallout];
            nextCallout += 1;
            if (callout.text === 'DOCKING' || callout.text.startsWith('DOCKED')) {
              if (!gameplay.descender.killed) continue;
            }
            say(callout.text, callout.hold);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        if (game.state === 'ended') {
          // A run cut short mid-climb still wears its lean; let it settle, not snap.
          endedFor += dt;
          viewQuaternionAt(runTime, endLean);
          settled.identity().slerp(endLean, 1 - Math.min(1, endedFor / 1.2) ** 2);
          camera.quaternion.premultiply(settled);
          camera.updateMatrixWorld();
        } else {
          endedFor = 0;
        }
        if (!running) updateCameraFeel(dt, runTime, false);
        updateVisuals(dt, {
          camera,
          elapsed,
          runTime,
          mode: game.state,
          descender: gameplay.descender,
          health,
        });
      },
      dispose() {
        feel.dispose();
        game.dispose();
        scene.fog = null;
        camera.far = previousFar;
        camera.updateProjectionMatrix();
      },
    };
  },
};
