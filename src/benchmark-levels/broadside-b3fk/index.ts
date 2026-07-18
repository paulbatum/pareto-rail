import type { LevelDefinition } from '../../engine/types';
import { Quaternion, Vector3 } from 'three';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { sampleRailFrame } from '../../engine/rail';
import { createAudio } from './audio';
import { createBroadsideB3fkGameplay, createBroadsideB3fkRail } from './gameplay';
import {
  BROADSIDE_B3FK_BPM,
  BROADSIDE_B3FK_MARKERS,
  BROADSIDE_B3FK_RUN_SECTIONS,
  BROADSIDE_B3FK_TIME,
} from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeVisuals,
  forceVictoryVisuals,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const broadsideB3fkLevel: LevelDefinition = {
  id: 'broadside-b3fk',
  title: 'Broadside',
  description: 'Launch into a magenta-and-gold fleet engagement, ride a cruiser broadside, and tear the enemy flagship open from shields to core.',
  bpm: BROADSIDE_B3FK_BPM,
  debugSelector: {
    queryParam: 'broadside-debug',
    label: 'Broadside inspection',
    options: [{ id: 'victory', title: 'Victory cascade' }],
  },
  markers: BROADSIDE_B3FK_MARKERS,
  sections: BROADSIDE_B3FK_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_B3FK_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x030008,
    bloom: { strength: 0.92, threshold: 0.64, radius: 0.14 },
    vignette: { inner: 0.34, outer: 1.02, strength: 0.68 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip, debugValue }) {
    const cameraFeel = createCameraFeel(camera);
    const cinematicRail = createBroadsideB3fkRail();
    const cinematicBattle = sampleRailFrame(cinematicRail, 0.58);
    const cinematicTarget = cinematicBattle.position;
    const cinematicPosition = cinematicBattle.position.clone()
      .addScaledVector(cinematicBattle.right, 240)
      .addScaledVector(cinematicBattle.up, 150)
      .addScaledVector(cinematicBattle.tangent, 210);
    const baseQuaternion = new Quaternion();
    const targetQuaternion = new Quaternion();
    const basePosition = new Vector3();
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene, cameraFeel);

    let runTime = 0;
    let elapsedNow = 0;
    let nextCallout = 0;
    let calloutUntil = -1;
    let shieldsRemaining = 4;
    let coresRemaining = 3;
    let debugVictoryApplied = false;
    const shieldIds = new Set<number>();
    const coreIds = new Set<number>();
    const callouts = [
      { at: 0.2, text: 'CLEAR THE DECK — LAUNCH', hold: 2.2 },
      { at: BROADSIDE_B3FK_MARKERS.melee, text: 'FLEET ENGAGEMENT', hold: 1.5 },
      { at: BROADSIDE_B3FK_MARKERS.broadside, text: 'FRIENDLY BROADSIDE — BANK HARD', hold: 2.1 },
      { at: BROADSIDE_B3FK_MARKERS.enemyBelly, text: 'ENEMY BELLY — RAKE THE GUNS', hold: 2.0 },
      { at: BROADSIDE_B3FK_MARKERS.eye, text: 'THE EYE', hold: 1.5 },
      { at: BROADSIDE_B3FK_MARKERS.flagship, text: 'FLAGSHIP — STRIP SHIELD GENERATORS', hold: 2.5 },
      { at: BROADSIDE_B3FK_MARKERS.secondPass, text: 'SHIELD DOWN — SECOND PASS', hold: 2.0 },
      { at: BROADSIDE_B3FK_MARKERS.trench, text: 'DIVE THE TRENCH — EXPOSED POWER', hold: 2.2 },
      { at: BROADSIDE_B3FK_MARKERS.victory, text: 'PULL OUT', hold: 1.7 },
    ];
    const say = (text: string, hold: number) => {
      hud.setCallout(text);
      calloutUntil = elapsedNow + hold;
    };

    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      shieldsRemaining = 4;
      coresRemaining = 3;
      debugVictoryApplied = false;
      shieldIds.clear();
      coreIds.clear();
      hud.setCallout('');
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'shieldGen') shieldIds.add(enemyId);
      if (kind === 'powerCore') coreIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (shieldIds.delete(enemyId)) {
        shieldsRemaining -= 1;
        say(shieldsRemaining > 0 ? `SHIELD GENERATORS ${shieldsRemaining}` : 'SHIELDS COLLAPSED', 1.45);
      }
      if (coreIds.delete(enemyId)) {
        coresRemaining -= 1;
        say(coresRemaining > 0 ? `POWER SYSTEMS ${coresRemaining}` : 'CORE CASCADE — BREAK AWAY', coresRemaining > 0 ? 1.3 : 3);
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
      level: createBroadsideB3fkGameplay(bus),
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
          if (debugValue === 'victory' && !debugVictoryApplied && runTime >= BROADSIDE_B3FK_MARKERS.trench + 2.8) {
            debugVictoryApplied = true;
            forceVictoryVisuals();
          }
          while (nextCallout < callouts.length && runTime >= callouts[nextCallout].at) {
            const callout = callouts[nextCallout];
            say(callout.text, callout.hold);
            nextCallout += 1;
          }
          // Authored banking and corkscrews sit after the runner has seated the camera.
          const flank = Math.max(0, Math.min(1, (runTime - BROADSIDE_B3FK_MARKERS.broadside) / 2.1))
            * Math.max(0, Math.min(1, (BROADSIDE_B3FK_MARKERS.enemyBelly - runTime) / 1.1));
          const belly = Math.max(0, Math.min(1, (runTime - BROADSIDE_B3FK_MARKERS.enemyBelly) / 1.4))
            * Math.max(0, Math.min(1, (BROADSIDE_B3FK_MARKERS.eye - runTime) / 1.1));
          const trench = Math.max(0, Math.min(1, (runTime - BROADSIDE_B3FK_MARKERS.trench) / 1.1));
          camera.rotateZ(-0.34 * flank + 0.28 * belly + Math.sin((runTime - BROADSIDE_B3FK_MARKERS.trench) * 2.2) * 0.09 * trench);
          camera.rotateX(Math.sin(runTime * 0.8) * 0.01 + trench * 0.035);
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        updateVisuals(dt, { scene, camera, feel: cameraFeel, elapsed, runTime, running: game.state === 'running' });
        cameraFeel.update(dt, {
          shake: { pitchDegrees: 0.36, yawDegrees: 0.32, rollDegrees: 1.1, frequency: 11 },
        });
        if (game.state === 'running' && runTime >= BROADSIDE_B3FK_MARKERS.victory) {
          const rawPull = Math.max(0, Math.min(1, (runTime - BROADSIDE_B3FK_MARKERS.victory) / 1));
          const pull = rawPull * rawPull * (3 - 2 * rawPull);
          basePosition.copy(camera.position);
          baseQuaternion.copy(camera.quaternion);
          camera.position.copy(basePosition).lerp(cinematicPosition, pull);
          camera.lookAt(cinematicTarget);
          targetQuaternion.copy(camera.quaternion);
          camera.quaternion.copy(baseQuaternion).slerp(targetQuaternion, pull);
          camera.fov = Math.min(94, camera.fov + pull * 12);
          camera.updateProjectionMatrix();
        }
      },
      dispose() {
        game.dispose();
        disposeVisuals(scene, camera);
        cameraFeel.dispose();
      },
    };
  },
};
