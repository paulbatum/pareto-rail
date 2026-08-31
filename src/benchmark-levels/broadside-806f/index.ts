import { MathUtils } from 'three';
import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  broadside806fRunProgress,
  broadside806fSpeedAt,
  createBroadside806fGameplay,
} from './gameplay';
import {
  BROADSIDE_806F_BPM,
  BROADSIDE_806F_MARKERS,
  BROADSIDE_806F_RUN_SECTIONS,
  BROADSIDE_806F_TIME,
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
  updateVisuals,
} from './visuals';

export const broadside806fLevel: LevelDefinition = {
  id: 'broadside-806f',
  title: 'Broadside',
  description: 'Launch into a fleet engagement, skim two capital ships, and break the enemy flagship from shield generators to trench core.',
  bpm: BROADSIDE_806F_BPM,
  markers: BROADSIDE_806F_MARKERS,
  sections: BROADSIDE_806F_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_806F_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x03020a,
    bloom: { strength: 0.92, threshold: 0.68, radius: 0.16 },
    vignette: { inner: 0.31, outer: 1.06, strength: 0.68 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, feel);

    let runTime = 0;
    let elapsedNow = 0;
    let calloutUntil = -1;
    let calloutIndex = 0;
    let generatorCount = 0;
    let powerCount = 0;
    const generatorIds = new Set<number>();
    const powerIds = new Set<number>();

    const callouts = [
      { at: BROADSIDE_806F_TIME.bar(0.25), text: 'FLAG DECK — SORTIE', hold: 1.7 },
      { at: BROADSIDE_806F_MARKERS.engagement, text: 'FLEETS IN CONTACT', hold: 1.7 },
      { at: BROADSIDE_806F_MARKERS.broadside + 1.6, text: 'FRIENDLY CRUISER — HOLD THE FLANK', hold: 2.2 },
      { at: BROADSIDE_806F_MARKERS.underbelly, text: 'ENEMY BELLY — RAKE THE GUNS', hold: 2.1 },
      { at: BROADSIDE_806F_MARKERS.eye, text: 'THE EYE', hold: 1.8 },
      { at: BROADSIDE_806F_MARKERS.flagship, text: 'FLAGSHIP — BREAK FOUR GENERATORS', hold: 2.5 },
      { at: BROADSIDE_806F_MARKERS.turn, text: 'ESCORT WAVE — COME ABOUT', hold: 1.9 },
      { at: BROADSIDE_806F_MARKERS.trench, text: 'DIVE THE TRENCH — THREE POWER SYSTEMS', hold: 2.5 },
    ];

    const say = (text: string, seconds: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + seconds;
    };

    bus.on('runstart', () => {
      runTime = 0;
      calloutIndex = 0;
      calloutUntil = -1;
      generatorCount = 0;
      powerCount = 0;
      generatorIds.clear();
      powerIds.clear();
      hud.setCallout('');
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'generator') generatorIds.add(enemyId);
      if (kind === 'power') powerIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (generatorIds.delete(enemyId)) {
        generatorCount += 1;
        if (generatorCount < 4) say(`SHIELD GENERATORS ${4 - generatorCount}`, 1.15);
      }
      if (powerIds.delete(enemyId)) {
        powerCount += 1;
        if (powerCount < 3) say(`POWER SYSTEMS ${3 - powerCount}`, 1.15);
      }
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say('SHIELD COLLAPSED — FIGHT THROUGH', 2.5);
      if (phase === 'destroyed') say('FLAGSHIP BREAKING — ENEMY LINE SCATTERING', 4.0);
    });

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip: `${startTip} • Intercept crimson flak. Capital targets accept repeat locks.`,
      level: createBroadside806fGameplay(bus),
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
          while (calloutIndex < callouts.length && runTime >= callouts[calloutIndex].at) {
            const callout = callouts[calloutIndex];
            say(callout.text, callout.hold);
            calloutIndex += 1;
          }
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }

        const eye = 1 - MathUtils.clamp(Math.abs(runTime - (BROADSIDE_806F_MARKERS.eye + 1.6)) / 2.4, 0, 1);
        const speed = broadside806fSpeedAt(runTime);
        feel.setFovOffset(MathUtils.clamp((speed - 0.75) * 6.5, -2, 10) - eye * 4.5, { response: 6 });
        updateVisuals(dt, {
          scene,
          camera,
          elapsed,
          runTime,
          runProgress: broadside806fRunProgress(runTime),
          running: game.state === 'running',
        });
        feel.update(dt, {
          shake: { pitchDegrees: 0.42, yawDegrees: 0.34, rollDegrees: 1.15, frequency: 10.5 },
        });
      },
      dispose() {
        game.dispose();
        disposeVisuals();
        feel.dispose();
        hud.setCallout('');
      },
    };
  },
};
