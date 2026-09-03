import type { LevelDefinition } from '../../engine/types';
import { createCameraFeel } from '../../engine/camera-feel';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { createAudio } from './audio';
import {
  BROADSIDE_AMR2_BPM,
  BROADSIDE_AMR2_MARKERS,
  BROADSIDE_AMR2_RUN_DURATION,
  BROADSIDE_AMR2_RUN_SECTIONS,
  BROADSIDE_AMR2_TIME,
  createBroadsideAmr2Gameplay,
} from './gameplay';
import {
  createEnemyMesh,
  createEnvironment,
  createProjectileMesh,
  createReticle,
  installVisualEventHandlers,
  setEnemyDenied,
  setEnemyLocked,
  setReticleActive,
  updateVisuals,
} from './visuals';

export const broadsideAmr2Level: LevelDefinition = {
  id: 'broadside-amr2',
  title: 'Broadside',
  description: 'Launch off the flagship into a full fleet engagement — thread the cruiser gaps and break the enemy flagship.',
  bpm: BROADSIDE_AMR2_BPM,
  markers: { ...BROADSIDE_AMR2_MARKERS, flagshipBoss: BROADSIDE_AMR2_MARKERS.flagship },
  sections: BROADSIDE_AMR2_RUN_SECTIONS.map((section) => ({
    name: section.name,
    time: BROADSIDE_AMR2_TIME.bar(section.fromBar),
  })),
  post: {
    clearColor: 0x030109,
    bloom: { strength: 0.65, threshold: 0.6, radius: 0.25 },
    vignette: { inner: 0.32, outer: 1.0, strength: 0.55 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const feel = createCameraFeel(camera);
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);

    // Battle callouts. Gameplay owns the fight; this just narrates it.
    let calloutUntil = -1;
    let now = 0;
    let runClock = 0;
    let running = false;
    const say = (message: string, seconds: number) => {
      hud.setCallout(message);
      calloutUntil = now + seconds;
    };
    bus.on('runstart', () => {
      calloutUntil = -1;
      runClock = 0;
      running = true;
      say('LAUNCH — WEAPONS FREE', 2.4);
    });
    bus.on('runend', () => {
      running = false;
    });
    bus.on('bossphase', ({ phase }) => {
      if (phase === 'summoned') say('ENEMY FLAGSHIP', 2.6);
      if (phase === 'exposed') say('SHIELDS DOWN — DIVE THE TRENCH', 3.0);
      if (phase === 'destroyed') say('FLAGSHIP BREAKING', 3.4);
    });

    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip: startTip || 'Hold to charge — sweep across targets — release the volley',
      level: createBroadsideAmr2Gameplay(bus),
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
        if (running) {
          runClock += dt;
          const { broadside, belly, eye, flagship, trench, finale } = BROADSIDE_AMR2_MARKERS;
          if (Math.abs(runClock - broadside) < dt * 0.6) say('BROADSIDE — FULL GUNS', 2.4);
          else if (Math.abs(runClock - belly) < dt * 0.6) say('RAKE THEIR BELLY', 2.2);
          else if (Math.abs(runClock - eye) < dt * 0.6) say('EYE OF THE BATTLE', 2.6);
          else if (Math.abs(runClock - trench) < dt * 0.6) say('INTO THE TRENCH', 2.4);
          else if (Math.abs(runClock - finale) < dt * 0.6) say('FINISH HER', 2.4);
        }
        if (calloutUntil >= 0 && elapsed >= calloutUntil) {
          calloutUntil = -1;
          hud.setCallout('');
        }
        game.update(dt);
        updateVisuals(dt, {
          scene,
          camera,
          feel,
          elapsed,
          runTime: running ? runClock : BROADSIDE_AMR2_RUN_DURATION,
          runProgress: game.runProgress,
        });
        feel.update(dt);
      },
      dispose() {
        feel.dispose();
        game.dispose();
      },
    };
  },
};
