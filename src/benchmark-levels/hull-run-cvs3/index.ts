import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createHullRunCvs3Gameplay, HULL_RUN_CVS3_BPM, hullRunProgress } from './gameplay';
import { HULL_RUN_CVS3_MARKERS, HULL_RUN_CVS3_SECTIONS, HULL_RUN_CVS3_TIME } from './timing';
import {
  createEnemyMesh, createEnvironment, createProjectileMesh, createReticle, disposeVisuals,
  installVisualEventHandlers, setEnemyDenied, setEnemyLocked, setReticleActive, updateVisuals,
} from './visuals';

export const hullRunCvs3Level: LevelDefinition = {
  id: 'hull-run-cvs3',
  title: 'Hull Run',
  description: 'Skim a waking warship, break its defense grid, and silence the last bow gun.',
  bpm: HULL_RUN_CVS3_BPM,
  markers: HULL_RUN_CVS3_MARKERS,
  sections: HULL_RUN_CVS3_SECTIONS.map((section) => ({ name: section.name, time: HULL_RUN_CVS3_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x010306,
    bloom: { strength: 0.72, threshold: 0.73, radius: 0.12 },
    vignette: { inner: 0.3, outer: 1.08, strength: 0.72 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    let runTime = 0; let now = 0; let clearCalloutAt = -1; let calloutIndex = 0; let turretId = -1;
    const callouts = [
      { at: HULL_RUN_CVS3_TIME.bar(4), text: 'DECK SECTIONS WAKING' },
      { at: HULL_RUN_CVS3_TIME.bar(12), text: 'POINT DEFENSE ONLINE' },
      { at: HULL_RUN_CVS3_TIME.bar(20), text: 'GENERAL QUARTERS' },
      { at: HULL_RUN_CVS3_TIME.bar(26), text: 'BOW BATTERY — WATCH THE VENTS' },
      { at: HULL_RUN_CVS3_TIME.bar(35), text: 'OFF THE BOW' },
    ];
    const say = (text: string, hold = 2.2) => { hud.setCallout(text); clearCalloutAt = now + hold; };
    bus.on('runstart', () => { runTime = 0; calloutIndex = 0; clearCalloutAt = -1; turretId = -1; hud.setCallout(''); });
    bus.on('spawn', ({ enemyId, kind }) => { if (kind === 'turret') turretId = enemyId; });
    bus.on('bossphase', ({ phase }) => { if (phase === 'exposed') say('HEAT VENTS OPEN', 1.15); });
    bus.on('kill', ({ enemyId }) => {
      if (enemyId === turretId) { bus.emit('bossphase', { phase: 'destroyed' }); say('BOW BATTERY SILENCED', 3); }
    });

    const gameplay = createHullRunCvs3Gameplay(bus);
    const game = createLockOnRunner({
      scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip: `${startTip} • Intercept red shells. Fire when the bow vents.`,
      level: gameplay,
      visuals: { createEnemyMesh, setEnemyLocked, setEnemyDenied, createProjectileMesh, createReticle, setReticleActive },
    });
    return {
      update(dt, elapsed) {
        now = elapsed;
        if (game.state === 'running') {
          runTime += dt;
          while (calloutIndex < callouts.length && runTime >= callouts[calloutIndex].at) { say(callouts[calloutIndex].text); calloutIndex += 1; }
        }
        if (clearCalloutAt >= 0 && elapsed >= clearCalloutAt) { hud.setCallout(''); clearCalloutAt = -1; }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, runProgress: hullRunProgress(runTime), running: game.state === 'running' });
      },
      dispose() { game.dispose(); disposeVisuals(); hud.setCallout(''); },
    };
  },
};
