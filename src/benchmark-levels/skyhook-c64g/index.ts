import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { bossState } from './boss';
import { createAudio } from './audio';
import { createSkyhookGameplay, SKYHOOK_BPM } from './gameplay';
import { DECK_TIME, DOCK_TIME, SKYHOOK_DURATION, SKYHOOK_MARKERS, SKYHOOK_RUN_SECTIONS, SKYHOOK_TIME } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraEffects as updateSkyhookCameraEffects,
  updateVisuals,
} from './visuals';
import { composeSkyhookOutput } from './visuals/post-fx';

export const skyhookC64gLevel: LevelDefinition = {
  id: 'skyhook-c64g',
  title: 'Skyhook',
  description: 'Ride a climber car up a space elevator — storm, cloud deck, thinning sky, station — and cut down the thing coming down the cable.',
  bpm: SKYHOOK_BPM,
  markers: SKYHOOK_MARKERS,
  sections: SKYHOOK_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: SKYHOOK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x000000,
    // Note: the shared post pipeline hands `threshold` to the bloom node's *radius*
    // slot and `radius` to its luminance *threshold* slot. These values are chosen for
    // what the pipeline actually does: a wide-ish soft glow (0.34) that only picks up
    // luminance above 0.86 — hot orange cores, sparks, the sun — and leaves the sky alone.
    bloom: { strength: 0.85, threshold: 0.34, radius: 0.86 },
    vignette: { inner: 0.42, outer: 1.18, strength: 0.5 },
    composeOutput: composeSkyhookOutput,
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const cameraFeel = createCameraFeel(camera);
    createEnvironment(scene);

    // Narration: the climb's set pieces get named. Gameplay owns the fight;
    // this only watches the clock, the bus and the boss's distance.
    let runTime = 0;
    let calloutUntil = -1;
    let now = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    installVisualEventHandlers(bus, scene, cameraFeel, camera, say);

    const timedCallouts = [
      { at: 0.7, text: 'STORM CELL — HOLD ON', hold: 2.4 },
      { at: DECK_TIME - 2.9, text: 'CLOUD DECK AHEAD', hold: 2.0 },
      { at: DECK_TIME + 0.5, text: 'ABOVE THE WEATHER', hold: 2.4 },
      { at: SKYHOOK_TIME.bar(10, 0.4), text: 'THE AIR GIVES OUT', hold: 2.4 },
      { at: DOCK_TIME - 0.4, text: 'STATION — DOCKING', hold: 3.2 },
      { at: SKYHOOK_DURATION - 1.7, text: 'DOCKED', hold: 30 },
      { at: SKYHOOK_DURATION + 100, text: '', hold: 0 }, // sentinel; never fires
    ];
    let nextCallout = 0;
    let lastBossBand = Infinity;
    let tearingAnnounced = false;

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      lastBossBand = Infinity;
      tearingAnnounced = false;
      calloutUntil = -1;
      hud.setCallout('');
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
        updateCameraEffects(context) {
          gameplay.updateCameraEffects?.(context);
          updateSkyhookCameraEffects(context.dt, { camera, runTime: context.runTime, running: true, feel: cameraFeel });
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
          // The Ripper's distance, called out every fifty metres once it is close enough to matter.
          if ((bossState.phase === 'approach' || bossState.phase === 'exposed') && !bossState.tearing) {
            const band = Math.floor(bossState.distance / 50);
            if (band < lastBossBand && bossState.distance < 320) {
              lastBossBand = band;
              say(`RIPPER — ${Math.round(bossState.distance / 10) * 10} M`, 1.6);
            }
          }
          if (bossState.tearing && !tearingAnnounced) {
            tearingAnnounced = true;
            say('HULL BREACH — IT HAS THE CAR', 3);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        const state = game.state;
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          running: state === 'running',
          ended: state === 'ended',
          feel: cameraFeel,
        });
      },
      dispose() {
        cameraFeel.dispose();
        game.dispose();
      },
    };
  },
};
