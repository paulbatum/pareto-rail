import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createSkyhookGameplay, SKYHOOK_9UIB_BPM, SKYHOOK_MARKERS } from './gameplay';
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

export const skyhook9uibLevel: LevelDefinition = {
  id: 'skyhook-9uib',
  title: 'Skyhook',
  description: 'Defend a climber car from storm ceiling to orbital dock.',
  bpm: SKYHOOK_9UIB_BPM,
  markers: SKYHOOK_MARKERS,
  sections: [
    { name: 'Weather', time: SKYHOOK_MARKERS.storm },
    { name: 'Cloudbreak', time: SKYHOOK_MARKERS.cloudbreak },
    { name: 'Thin Air', time: SKYHOOK_MARKERS.thinAir },
    { name: 'Clampfall', time: SKYHOOK_MARKERS.clampfall },
    { name: 'Docking', time: SKYHOOK_MARKERS.docking },
  ],
  post: {
    clearColor: 0x02050d,
    bloom: { strength: 0.55, threshold: 0.82, radius: 0.12 },
    vignette: { inner: 0.38, outer: 1.08, strength: 0.48 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let calloutUntil = -1;
    let elapsedNow = 0;
    let nextCallout = 0;
    let bossId = -1;
    const callouts = [
      { at: SKYHOOK_MARKERS.cloudbreak - 0.35, text: 'CLOUD DECK — HOLD THE CAR', hold: 2.5 },
      { at: SKYHOOK_MARKERS.thinAir, text: 'ATMOSPHERE FALLING AWAY', hold: 2.5 },
      { at: SKYHOOK_MARKERS.clampfall, text: 'TETHER CLAMP — 13 SECONDS TO CONTACT', hold: 3.2 },
      { at: SKYHOOK_MARKERS.docking, text: 'STATION ACQUISITION', hold: 3.0 },
    ];
    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + hold;
    };
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'clamp') bossId = enemyId;
    });
    bus.on('stage', ({ enemyId, stageIndex }) => {
      if (enemyId === bossId) say(stageIndex === 1 ? 'OUTER JAWS BROKEN' : 'CORE CLAMP EXPOSED', 2.1);
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === bossId) say('CLAMP RELEASED — DOCKING CORRIDOR CLEAR', 4.0);
    });
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      bossId = -1;
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
        elapsedNow = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout++];
            say(callout.text, callout.hold);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { camera, runTime, running: game.state === 'running' });
      },
      dispose() {
        game.dispose();
        disposeEnvironment();
      },
    };
  },
};
