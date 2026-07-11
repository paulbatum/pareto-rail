import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createHullRunNs5nGameplay, HULL_RUN_NS5N_BPM, HULL_RUN_NS5N_MARKERS, HULL_RUN_NS5N_RUN_DURATION } from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const hullRunNs5nLevel: LevelDefinition = {
  id: 'hull-run-ns5n',
  title: 'Hull Run',
  description: 'Skim a waking warship hull, break its defenses, and vent the last bow battery before the deck ends.',
  bpm: HULL_RUN_NS5N_BPM,
  markers: HULL_RUN_NS5N_MARKERS,
  sections: [
    { name: 'Dark deck', time: 0 },
    { name: 'Running lights', time: HULL_RUN_NS5N_MARKERS.firstWake },
    { name: 'Batteries online', time: HULL_RUN_NS5N_MARKERS.batteriesOnline },
    { name: 'Full alert', time: HULL_RUN_NS5N_MARKERS.fullAlert },
    { name: 'Bow turret', time: HULL_RUN_NS5N_MARKERS.bowTurret },
    { name: 'Off the bow', time: HULL_RUN_NS5N_MARKERS.bowDrop },
  ],
  post: {
    clearColor: 0x080a0c,
    bloom: { strength: 0.9, threshold: 0.68, radius: 0.14 },
    vignette: { inner: 0.34, outer: 1.05, strength: 0.7 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    const callouts = [
      { at: HULL_RUN_NS5N_MARKERS.firstWake, text: 'RUNNING LIGHTS — FORWARD', hold: 2.2 },
      { at: HULL_RUN_NS5N_MARKERS.batteriesOnline, text: 'SECONDARY BATTERIES ONLINE', hold: 2.3 },
      { at: HULL_RUN_NS5N_MARKERS.fullAlert, text: 'GENERAL QUARTERS', hold: 2.0 },
      { at: HULL_RUN_NS5N_MARKERS.bowTurret - 1.3, text: 'LAST BATTERY — WAIT FOR THE VENTS', hold: 3.0 },
      { at: HULL_RUN_NS5N_MARKERS.bowDrop, text: 'BOW CLEAR — HOLD COURSE', hold: 3.2 },
    ];
    let nextCallout = 0;
    const say = (text: string, hold: number) => { hud.setCallout(text); calloutUntil = elapsedNow + hold; };
    bus.on('runstart', () => { runTime = 0; nextCallout = 0; calloutUntil = -1; hud.setCallout(''); });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('ARMOR BREACHED — NEXT VENT', 1.8);
      if (phase === 'destroyed') say('BOW BATTERY DESTROYED', 2.8);
    });

    const gameplay = createHullRunNs5nGameplay(bus);
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

    return {
      update(dt, elapsed) {
        elapsedNow = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout++];
            say(callout.text, callout.hold);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) { calloutUntil = -1; hud.setCallout(''); }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runProgress: Math.min(1, runTime / HULL_RUN_NS5N_RUN_DURATION), running: game.state === 'running' });
      },
      dispose() {
        disposeEnvironment();
        game.dispose();
      },
    };
  },
};
