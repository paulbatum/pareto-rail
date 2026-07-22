import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSpeedsolveGameplay } from './gameplay';
import {
  SPEEDSOLVE_WVDV_BPM,
  SPEEDSOLVE_WVDV_MARKERS,
  SPEEDSOLVE_WVDV_SECTIONS,
  SPEEDSOLVE_WVDV_TIME,
} from './timing';
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

export const speedsolveWvdvLevel: LevelDefinition = {
  id: 'speedsolve-wvdv',
  title: 'Speedsolve',
  description: 'Shoot a colossal puzzle cube into solution, one beat-snapped face at a time.',
  bpm: SPEEDSOLVE_WVDV_BPM,
  markers: SPEEDSOLVE_WVDV_MARKERS,
  sections: SPEEDSOLVE_WVDV_SECTIONS.map(({ name, fromBar }) => ({ name, time: SPEEDSOLVE_WVDV_TIME.bar(fromBar) })),
  post: {
    clearColor: 0xbfc5ce,
    bloom: { strength: 0.3, threshold: 0.94, radius: 0.07 },
    vignette: { inner: 0.48, outer: 1.2, strength: 0.28 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    const feel = createCameraFeel(camera);
    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextCallout = 0;

    const callouts = [
      { at: SPEEDSOLVE_WVDV_MARKERS.white, text: 'WHITE FACE — FIND THE FOUR HOT SQUARES' },
      { at: SPEEDSOLVE_WVDV_MARKERS.red, text: 'RED FACE — LAYER TWO' },
      { at: SPEEDSOLVE_WVDV_MARKERS.blue, text: 'BLUE FACE — POLYHEDRA INBOUND' },
      { at: SPEEDSOLVE_WVDV_MARKERS.orange, text: 'ORANGE FACE — KEEP THE TEMPO' },
      { at: SPEEDSOLVE_WVDV_MARKERS.green, text: 'GREEN FACE — FIVE LAYERS LIVE' },
      { at: SPEEDSOLVE_WVDV_MARKERS.yellow, text: 'YELLOW FACE — LAST SHELL' },
      { at: SPEEDSOLVE_WVDV_MARKERS.shellOpen, text: 'SIX FACES CLEAR — MACHINERY EXPOSED' },
      { at: SPEEDSOLVE_WVDV_MARKERS.core, text: 'CORE SPINUP — FULL BARRAGE' },
      { at: SPEEDSOLVE_WVDV_MARKERS.resolve, text: 'CHECKMATE' },
    ];
    const showCallout = (text: string, hold = 1.8) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + hold;
    };

    const gameplay = createSpeedsolveGameplay(bus);
    const gameplayCameraEffects = gameplay.updateCameraEffects;
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
          gameplayCameraEffects?.(context);
          const corePressure = Math.max(0, (context.runTime - SPEEDSOLVE_WVDV_MARKERS.core) / 8);
          feel.setFovOffset(corePressure * 3.2);
          feel.update(context.dt);
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

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      showCallout('SPEEDSOLVE — SIX FACES / SIXTY SECONDS', 2.2);
    });
    bus.on('kill', ({ worldPosition }) => {
      if (worldPosition.length() < 4) {
        feel.shake(0.7);
        showCallout('CORE FRACTURE — SOLUTION ACCEPTED', 3.2);
      }
    });
    bus.on('stage', () => { feel.shake(0.32); });
    bus.on('playerhit', ({ healthRemaining }) => {
      feel.shake(0.48);
      showCallout(`COUNTERSHOT — HULL ${healthRemaining}/5`, 1.3);
    });

    return {
      update(dt, elapsed) {
        elapsedNow = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            showCallout(callouts[nextCallout].text);
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
        disposeEnvironment();
      },
    };
  },
};
