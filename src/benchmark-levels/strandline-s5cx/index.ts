import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineS5cxGameplay, STRANDLINE_S5CX_BPM, STRANDLINE_S5CX_MARKERS } from './gameplay';
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

export const strandlineS5cxLevel: LevelDefinition = {
  id: 'strandline-s5cx',
  title: 'Strandline',
  description: 'Free a moon-sized jellyfish by cutting a violet infestation from its living strands.',
  bpm: STRANDLINE_S5CX_BPM,
  markers: STRANDLINE_S5CX_MARKERS,
  sections: [
    { name: 'Sunlit strands', time: STRANDLINE_S5CX_MARKERS.shallows },
    { name: 'Green moon', time: STRANDLINE_S5CX_MARKERS.bellReveal },
    { name: 'Inner forest', time: STRANDLINE_S5CX_MARKERS.innerForest },
    { name: 'Quickening', time: STRANDLINE_S5CX_MARKERS.quickening },
    { name: 'Crown colony', time: STRANDLINE_S5CX_MARKERS.crown },
    { name: 'Liberation', time: STRANDLINE_S5CX_MARKERS.liberation },
  ],
  post: {
    clearColor: 0x031b48,
    bloom: { strength: 0.62, threshold: 0.78, radius: 0.18 },
    vignette: { inner: 0.36, outer: 1.08, strength: 0.42 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    let broodCount = 0;
    let parentId = -1;
    const broodIds = new Set<number>();
    const callouts = [
      { at: STRANDLINE_S5CX_MARKERS.bellReveal - 0.25, text: 'THE BELL — STILL ALIVE', hold: 2.6 },
      { at: STRANDLINE_S5CX_MARKERS.innerForest, text: 'BACK INTO THE STRANDS', hold: 2.2 },
      { at: STRANDLINE_S5CX_MARKERS.quickening, text: 'LUMINESCENCE RETURNING', hold: 2.5 },
      { at: STRANDLINE_S5CX_MARKERS.crown, text: 'CROWN COLONY — CUT THREE BROOD-ROOTS', hold: 3.2 },
    ];
    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + hold;
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      broodCount = 0;
      parentId = -1;
      broodIds.clear();
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'parent') parentId = enemyId;
      if (kind === 'brood') broodIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === parentId) say('THE PARENT IS LOOSE — LOOK BACK', 5.5);
      if (broodIds.delete(enemyId)) {
        broodCount += 1;
        say(`BROOD-ROOT ${broodCount}/3 SEVERED`, 1.6);
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('WEBBING DEAD — TEAR IT FREE', 3.2);
      if (phase === 'destroyed') say('STRANDLINE RESTORED', 5.5);
    });
    bus.on('stage', ({ enemyId, stageIndex }) => {
      if (enemyId === parentId) say(stageIndex === 1 ? 'CARAPACE SPLIT' : 'HOLDFAST EXPOSED', 1.8);
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
      level: createStrandlineS5cxGameplay(bus),
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
