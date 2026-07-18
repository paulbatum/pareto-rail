import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createStrandlineGameplay } from './gameplay';
import {
  STRANDLINE_BPM,
  STRANDLINE_MARKERS,
  STRANDLINE_RUN_SECTIONS,
  STRANDLINE_TIME,
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
  updateReleaseCamera,
  updateVisuals,
} from './visuals';

export const strandlineS8dwLevel: LevelDefinition = {
  id: 'strandline-s8dw',
  title: 'Strandline',
  description: 'Thread the glowing tentacles of a giant jellyfish, clear the parasite broods feeding its crown web, and tear the parent free.',
  bpm: STRANDLINE_BPM,
  markers: STRANDLINE_MARKERS,
  sections: STRANDLINE_RUN_SECTIONS.map((section) => ({ name: section.name, time: STRANDLINE_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x021829,
    bloom: { strength: 0.72, threshold: 0.66, radius: 0.2 },
    vignette: { inner: 0.31, outer: 1.08, strength: 0.56 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, camera, feel);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    let broods = 3;
    let parentFreed = false;
    let failureCalled = false;
    let parentId = -1;
    const broodIds = new Set<number>();
    const callouts: Array<{ at: number; text: string; hold: number; fov?: number; shake?: number }> = [
      { at: STRANDLINE_TIME.bar(5.8), text: 'THE STRANDS ARE STIRRING', hold: 2.1, fov: 1.4 },
      { at: STRANDLINE_MARKERS.moonReveal - 0.4, text: 'STRANDLINE — BELL IN VIEW', hold: 2.5, fov: 4.2, shake: 0.12 },
      { at: STRANDLINE_MARKERS.deepStrands, text: 'BACK INTO THE VEIL', hold: 1.8, fov: 3.3, shake: 0.24 },
      { at: STRANDLINE_MARKERS.crown - 0.5, text: 'CROWN INFESTATION — THE PARENT', hold: 2.8, fov: -3.8, shake: 0.32 },
    ];
    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + seconds;
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      broods = 3;
      broodIds.clear();
      parentFreed = false;
      failureCalled = false;
      parentId = -1;
      calloutUntil = -1;
      hud.setCallout('');
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'parent') parentId = enemyId;
      if (kind !== 'brood') return;
      broodIds.add(enemyId);
      if (broodIds.size === 1) say('CUT THE BROODS — WEB SECTORS 3', 2.6);
    });
    bus.on('stage', ({ enemyId, stageIndex, hitStageCount }) => {
      if (enemyId !== parentId) return;
      const anchors = Math.max(0, hitStageCount - stageIndex);
      say(anchors > 0 ? `PARENT ANCHORS ${anchors}` : 'PARENT LOOSE', 1.5);
    });
    bus.on('kill', ({ enemyId }) => {
      if (!broodIds.delete(enemyId)) return;
      broods -= 1;
      if (broods > 0) say(`WEB SECTORS ${broods}`, 1.4);
      else say('WEB GONE — PARENT EXPOSED', 2.8);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'destroyed') {
        parentFreed = true;
        say('STRANDLINE CLEAN — LET IT GO', 4);
      }
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
      level: createStrandlineGameplay(bus),
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
        game.update(dt);
        if (game.state === 'running') {
          runTime += dt;
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout];
            say(callout.text, callout.hold);
            if (callout.fov) feel.kickFov(callout.fov, { decay: callout.fov < 0 ? 1.3 : 2.2 });
            if (callout.shake) feel.shake(callout.shake, { decay: 2.5 });
            nextCallout += 1;
          }
          if (!failureCalled && !parentFreed && runTime >= STRANDLINE_MARKERS.release) {
            failureCalled = true;
            say('THE WEB HOLDS — INFESTATION REMAINS', 3.2);
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        updateVisuals(dt, { scene, camera, feel, elapsed, runTime, running: game.state === 'running' });
        feel.update(dt, { shake: { pitchDegrees: 0.32, yawDegrees: 0.28, rollDegrees: 0.9, frequency: 8.5 } });
        updateReleaseCamera(camera, runTime);
      },
      dispose() {
        game.dispose();
        disposeVisuals(scene, camera);
        feel.dispose();
      },
    };
  },
};
