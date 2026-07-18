import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { broadsideProgress, createBroadsideB6ejGameplay, BROADSIDE_B6EJ_BPM } from './gameplay';
import { BROADSIDE_B6EJ_MARKERS, BROADSIDE_B6EJ_SECTIONS, BROADSIDE_B6EJ_TIME } from './timing';
import {
  createEnemyMesh, createEnvironment, createProjectileMesh, createReticle, disposeVisuals,
  installVisualEventHandlers, setEnemyDenied, setEnemyLocked, setReticleActive, updateVisuals,
} from './visuals';

export const broadsideB6ejLevel: LevelDefinition = {
  id: 'broadside-b6ej',
  title: 'Broadside',
  description: 'Launch into a fleet engagement, skim two warships, and break the enemy flagship from shield line to trench core.',
  bpm: BROADSIDE_B6EJ_BPM,
  markers: BROADSIDE_B6EJ_MARKERS,
  sections: BROADSIDE_B6EJ_SECTIONS.map((section) => ({ name: section.name, time: BROADSIDE_B6EJ_TIME.bar(section.fromBar) })),
  post: {
    clearColor: 0x03030b,
    bloom: { strength: 0.56, threshold: 0.78, radius: 0.11 },
    vignette: { inner: 0.28, outer: 1.08, strength: 0.64 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene); installVisualEventHandlers(bus, scene);
    let runTime = 0; let now = 0; let clearCalloutAt = -1; let calloutIndex = 0;
    const callouts = [
      { at: BROADSIDE_B6EJ_TIME.bar(0), text: 'CATAPULT CLEAR — JOIN THE LINE' },
      { at: BROADSIDE_B6EJ_TIME.bar(4), text: 'FLEET MELEE' },
      { at: BROADSIDE_B6EJ_TIME.bar(10), text: 'FRIENDLY BROADSIDE — BANK LOW' },
      { at: BROADSIDE_B6EJ_TIME.bar(16), text: 'ENEMY BELLY — RAKE THE TURRETS' },
      { at: BROADSIDE_B6EJ_TIME.bar(22), text: 'THE EYE' },
      { at: BROADSIDE_B6EJ_TIME.bar(26), text: 'FLAGSHIP — STRIP FOUR GENERATORS' },
      { at: BROADSIDE_B6EJ_TIME.bar(30), text: 'SHIELD LINE COLLAPSING — ESCORTS!' },
      { at: BROADSIDE_B6EJ_TIME.bar(33), text: 'TRENCH OPEN — TAKE THE CORES' },
      { at: BROADSIDE_B6EJ_TIME.bar(35), text: 'ENEMY LINE BREAKING' },
    ];
    const say = (text: string, hold = 2.1) => { hud.setCallout(text); clearCalloutAt = now + hold; };
    bus.on('runstart', () => { runTime = 0; calloutIndex = 0; clearCalloutAt = -1; hud.setCallout(''); });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELDS DOWN — CORE TRENCH EXPOSED', 2.8);
      if (phase === 'destroyed') say('FLAGSHIP BREAKING', 3);
    });

    const gameplay = createBroadsideB6ejGameplay(bus);
    const game = createLockOnRunner({
      scene, camera, canvas, bus, hud, onPause, onFullscreen,
      startTip: `${startTip} • Intercept crimson flak. Strip all four generators before the trench dive.`,
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
        game.update(dt); updateVisuals(dt, { camera, elapsed, runTime, running: game.state === 'running' });
        if (game.state === 'running' && runTime > BROADSIDE_B6EJ_TIME.bar(35)) { camera.fov = 65 + broadsideProgress(runTime) * 13; camera.updateProjectionMatrix(); }
      },
      dispose() { game.dispose(); disposeVisuals(); hud.setCallout(''); camera.fov = 65; camera.updateProjectionMatrix(); },
    };
  },
};
