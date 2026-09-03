import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  createSkyhookV01uGameplay,
  SKYHOOK_V01U_BARS,
  SKYHOOK_V01U_BPM,
  SKYHOOK_V01U_MARKERS,
  SKYHOOK_V01U_RUN_DURATION,
  SKYHOOK_V01U_TIME,
} from './gameplay';
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

export const skyhookV01uLevel: LevelDefinition = {
  id: 'skyhook-v01u',
  title: 'Skyhook',
  description: 'Ride a climber car through weather and vacuum, then sever the machine climbing down the tether before docking at the station.',
  bpm: SKYHOOK_V01U_BPM,
  markers: SKYHOOK_V01U_MARKERS,
  sections: [
    { name: 'storm', time: SKYHOOK_V01U_TIME.bar(SKYHOOK_V01U_BARS.storm) },
    { name: 'cloud deck', time: SKYHOOK_V01U_TIME.bar(SKYHOOK_V01U_BARS.cloudDeck) },
    { name: 'stratosphere', time: SKYHOOK_V01U_TIME.bar(SKYHOOK_V01U_BARS.stratosphere) },
    { name: 'edge', time: SKYHOOK_V01U_TIME.bar(SKYHOOK_V01U_BARS.edge) },
    { name: 'boss tether', time: SKYHOOK_V01U_TIME.bar(SKYHOOK_V01U_BARS.boss) },
    { name: 'docking', time: SKYHOOK_V01U_TIME.bar(SKYHOOK_V01U_BARS.docking) },
  ],
  post: {
    clearColor: 0x020711,
    // The shared BloomNode currently receives radius before threshold; these
    // values keep Skyhook's thin orange hardware bright without blooming the
    // broad blue atmosphere into a white screen.
    bloom: { strength: 0.55, threshold: 0.14, radius: 0.95 },
    vignette: { inner: 0.34, outer: 1.08, strength: 0.64 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);
    const gameplay = createSkyhookV01uGameplay(bus);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip: `${startTip}  |  Protect the climber car`,
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

    let elapsed = 0;
    let runClock = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    const timedCallouts = [
      { at: SKYHOOK_V01U_MARKERS.cloudDeck, text: 'CLOUD DECK', hold: 1.8 },
      { at: SKYHOOK_V01U_MARKERS.stratosphere, text: 'THIN AIR', hold: 1.8 },
      { at: SKYHOOK_V01U_MARKERS.edge, text: 'NO AIR', hold: 1.8 },
    ];
    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = elapsed + hold;
    };

    bus.on('runstart', () => {
      runClock = 0;
      nextCallout = 0;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('SKYHOOK DESCENDING', 2.4);
      else if (phase === 'exposed') say('TETHER CORE EXPOSED', 2.2);
      else if (phase === 'destroyed') say('TETHER CLEAR — DOCKING', 3.2);
    });

    return {
      update(dt, now) {
        elapsed = now;
        game.update(dt);
        if (game.state === 'running') {
          runClock += dt;
          while (nextCallout < timedCallouts.length && runClock >= timedCallouts[nextCallout].at) {
            const callout = timedCallouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime: runClock,
          runProgress: game.runProgress,
          running: game.state === 'running',
          feel,
        });
      },
      dispose() {
        game.dispose();
        disposeVisuals();
        feel.dispose();
      },
    };
  },
};
