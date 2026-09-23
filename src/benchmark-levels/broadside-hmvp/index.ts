import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import { createBroadsideGameplay } from './gameplay';
import { BARS, BROADSIDE_BPM, BROADSIDE_MARKERS, BROADSIDE_RUN_SECTIONS, BROADSIDE_TIME, bar } from './timing';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  disposeEnvironment,
  installVisualEventHandlers,
  resetCameraFeelState,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateCameraFeel,
  updateVisuals,
} from './visuals';
import { broadsidePost } from './visuals/post-fx';

// The battle spans kilometers: the far plane has to reach the enemy line and
// the flagship from the carrier's deck.
const CAMERA_NEAR = 0.3;
const CAMERA_FAR = 9000;

export const broadsideLevel: LevelDefinition = {
  id: 'broadside-hmvp',
  title: 'Broadside',
  description: 'Launch off your flagship into a full fleet engagement, run a cruiser\'s broadside, rake an enemy keel, and break the enemy flagship.',
  bpm: BROADSIDE_BPM,
  markers: BROADSIDE_MARKERS,
  sections: BROADSIDE_RUN_SECTIONS.map((section) => ({ name: section.name, time: BROADSIDE_TIME.bar(section.fromBar) })),
  post: broadsidePost,
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const previousNear = camera.near;
    const previousFar = camera.far;
    camera.near = CAMERA_NEAR;
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();

    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, feel);

    // Narration: set pieces get named on their downbeats.
    let runTime = 0;
    let calloutUntil = -1;
    let nextCallout = 0;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = runTime + seconds;
    };
    const timedCallouts = [
      { at: bar(BARS.catapult), text: 'LAUNCH', hold: 1.4 },
      { at: bar(BARS.broadside - 0.25), text: 'VALIANT — RUN HER FLANK. STOP THE BOMBERS', hold: 2.6 },
      { at: bar(BARS.belly), text: 'UNDER THE KEEL — RAKE THE GUNS', hold: 2.4 },
      { at: bar(BARS.flagship - 0.5), text: 'ENEMY FLAGSHIP — KILL THE SHIELD GENERATORS', hold: 2.8 },
      { at: bar(BARS.trench - 0.25), text: 'INTO THE TRENCH — HIT THE CORES', hold: 2.4 },
    ];
    let generators = 0;
    let generatorIds = new Set<number>();
    bus.on('runstart', () => {
      runTime = 0;
      nextCallout = 0;
      calloutUntil = -1;
      generators = 0;
      generatorIds = new Set<number>();
      hud.setCallout('');
      resetCameraFeelState();
    });
    bus.on('spawn', ({ enemyId, kind }) => {
      if (kind === 'generator') generatorIds.add(enemyId);
    });
    bus.on('kill', ({ enemyId }) => {
      if (generatorIds.delete(enemyId)) {
        generators += 1;
        say(generators === 4 ? 'SHIELD FAILING' : `GENERATOR ${generators} OF 4 DOWN`, 1.6);
      }
    });
    bus.on('volley', ({ size, kills }) => {
      if (size === 6 && kills === 6) say('FULL BROADSIDE', 1.1);
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'exposed') say(generators === 4 ? 'SHIELDS DOWN — ESCORTS INBOUND' : 'FLEET FIRE BREAKS THE SHIELD — ESCORTS INBOUND', 2.4);
      if (phase === 'destroyed') say('FLAGSHIP BREAKING — PULL OUT', 3);
    });

    const gameplay = createBroadsideGameplay(bus);
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
          updateCameraFeel(context.dt, feel, context.runTime);
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
        const running = game.state === 'running';
        if (running) {
          runTime += dt;
          while (nextCallout < timedCallouts.length && runTime >= timedCallouts[nextCallout].at) {
            say(timedCallouts[nextCallout].text, timedCallouts[nextCallout].hold);
            nextCallout += 1;
          }
        }
        if (calloutUntil >= 0 && runTime >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, { scene, camera, elapsed, runTime, running: game.state === 'running', feel });
      },
      dispose() {
        feel.dispose();
        game.dispose();
        disposeEnvironment(scene);
        camera.near = previousNear;
        camera.far = previousFar;
        camera.updateProjectionMatrix();
      },
    };
  },
};
